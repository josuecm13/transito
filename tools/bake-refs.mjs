#!/usr/bin/env node
/**
 * Offline reference bake for the layered map (docs/map-reshape/03-technical/00-conventions-and-bake.md).
 *
 *   npm run refs                          bake everything from Overpass (one request at a time)
 *   node tools/bake-refs.mjs --only canal,corredor-sur
 *   node tools/bake-refs.mjs --metrics-only   recompute metrics.yaml, warped drafts and overlay.svg from the committed refs (no network)
 *   node tools/bake-refs.mjs --fold           fold check of specs/map/anchors.yaml, exit 1 if a triangle folds
 *   options: --today YYYY-MM-DD   --endpoint URL   --pause-ms N
 *
 * Writes specs/map/refs/<id>.json (unwarped, simplified 20 m), landcover-<zone>.json (class areas),
 * warped/<id>.json (WARPED DRAFTS, map frame), metrics.yaml (F06) and overlay.svg.
 * Data: (c) OpenStreetMap contributors (ODbL). Reference only: the game never fetches or reads it.
 * A rerun on the same Overpass data is byte-identical (the date of an unchanged file is kept).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump, load } from 'js-yaml';
import { buildWarp, flippedTriples, foldCheck } from './warp-lib.ts';
import {
  COVER_ZONES, REF_SPECS, bakeCover, bakeRef, computeMetrics, coverQuery, overlaySvg, serializeCover, serializeRef, serializeWarped, warpRef,
} from './bake-refs-lib.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFS = join(ROOT, 'specs/map/refs');
const UA = 'transito-ref-bake/1.0 (offline dev tool; personal prototype)';

class ToolError extends Error {}
const p2 = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const o = { today: localDate(new Date()), only: null, metricsOnly: false, fold: false, endpoint: 'https://overpass-api.de/api/interpreter', pause: 6000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new ToolError(`${a}: missing value`); return v; };
    if (a === '--today') o.today = next();
    else if (a === '--only') o.only = next().split(',');
    else if (a === '--metrics-only') o.metricsOnly = true;
    else if (a === '--fold') o.fold = true;
    else if (a === '--endpoint') o.endpoint = next();
    else if (a === '--pause-ms') o.pause = Number(next());
    else throw new ToolError(`unknown argument ${a}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.today)) throw new ToolError('--today must be YYYY-MM-DD');
  return o;
}

async function overpass(endpoint, query) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new ToolError(`Overpass is not answering at ${endpoint} (${e?.cause?.code || e?.message})`);
    }
    if (res.ok) return res.json();
    if (attempt === 0 && [429, 502, 503, 504].includes(res.status)) { await sleep(30_000); continue; }
    throw new ToolError(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** Write unless identical; an unchanged body (ignoring provenance.date) keeps the old date. */
function writeStable(path, text) {
  if (existsSync(path)) {
    const old = readFileSync(path, 'utf8');
    const strip = (s) => s.replace(/"date":"\d{4}-\d{2}-\d{2}"/, '"date":"-"').replace(/"date": "\d{4}-\d{2}-\d{2}"/, '"date": "-"');
    if (strip(old) === strip(text)) return false;
  }
  writeFileSync(path, text);
  return true;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function loadWorld() {
  const w = load(readFileSync(join(ROOT, 'specs/map/world.yaml'), 'utf8'));
  return { land: w.geometry.land, routes: Object.fromEntries(Object.entries(w.routes).map(([k, v]) => [k, v.points])) };
}
const loadAnchors = () => load(readFileSync(join(ROOT, 'specs/map/anchors.yaml'), 'utf8')).anchors;

function foldCommand() {
  const anchors = loadAnchors();
  const f = foldCheck(anchors);
  const t = flippedTriples(anchors);
  console.log(`anchors: ${anchors.length}, Delaunay triangles (map space): ${f.triangles}, folded: ${f.folded.length}`);
  for (const x of f.folded) console.log(`  FOLD ${x.ids.join(' / ')}  real area ${Math.round(x.realArea)} m2, map area ${Math.round(x.mapArea)} m2`);
  for (const a of f.anchorFolds) console.log(`  anchor ${a.id}: in ${a.folded} folded triangle(s)`);
  console.log(`flipped triples (necessary condition, any triangulation): ${t.flipped.length} of ${t.total}`);
  for (const x of t.flipped) console.log(`  flipped ${x.join(' / ')}`);
  return f.ok ? 0 : 1;
}

function derive(today) {
  const refs = {};
  for (const s of REF_SPECS) { const p = join(REFS, `${s.id}.json`); if (existsSync(p)) refs[s.id] = readJson(p); }
  const cover = {};
  for (const z of COVER_ZONES) { const p = join(REFS, `landcover-${z.id}.json`); if (existsSync(p)) cover[z.id] = readJson(p); }
  const metrics = computeMetrics(refs, cover);
  const yamlText = '# F06 frozen reference metrics. Generated by tools/bake-refs.mjs from the UNWARPED refs; do not edit by hand.\n# (c) OpenStreetMap contributors (ODbL).\n' + dump(metrics, { sortKeys: true, lineWidth: 140, noRefs: true });
  writeFileSync(join(REFS, 'metrics.yaml'), yamlText);

  const { land, routes } = loadWorld();
  const warp = buildWarp(loadAnchors());
  mkdirSync(join(REFS, 'warped'), { recursive: true });
  const warped = [];
  for (const id of Object.keys(refs).sort()) {
    const w = warpRef(refs[id], warp, land);
    warped.push(w);
    writeFileSync(join(REFS, 'warped', `${id}.json`), serializeWarped(w));
  }
  writeFileSync(join(REFS, 'overlay.svg'), overlaySvg({ land, routes, anchors: loadAnchors(), warped }));
  for (const w of warped) console.log(`warped ${w.id}: ${w.outside_land.outside}/${w.outside_land.total} points outside geometry.land (${(w.outside_land.fraction * 100).toFixed(1)} %, worst ${w.outside_land.max_distance_m} m)`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.fold) process.exit(foldCommand());
  mkdirSync(REFS, { recursive: true });
  if (!o.metricsOnly) {
    const jobs = [
      ...REF_SPECS.map((s) => ({ id: s.id, query: s.query.replace(/\[bbox\]/g, `(${s.bbox.join(',')})`), done: (data) => writeStable(join(REFS, `${s.id}.json`), serializeRef(bakeRef(s, data, o.today))) })),
      ...COVER_ZONES.map((z) => ({ id: `landcover-${z.id}`, query: coverQuery(z.bbox), done: (data) => writeStable(join(REFS, `landcover-${z.id}.json`), serializeCover(bakeCover(z, data, o.today))) })),
    ].filter((j) => !o.only || o.only.includes(j.id));
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      console.log(`[${i + 1}/${jobs.length}] ${j.id}`);
      let data;
      try { data = await overpass(o.endpoint, j.query); } catch (e) { console.error(`  FAILED: ${e.message}`); process.exitCode = 1; continue; }
      console.log(`  ${data.elements.length} elements, ${j.done(data) ? 'written' : 'unchanged'}`);
      if (i < jobs.length - 1) await sleep(o.pause);
    }
  }
  derive(o.today);
  console.log(`refs: ${readdirSync(REFS).length} entries in specs/map/refs. Data (c) OpenStreetMap contributors (ODbL).`);
}

main().catch((e) => {
  if (e instanceof ToolError) { console.error(`bake-refs: ${e.message}`); process.exit(1); }
  throw e;
});
