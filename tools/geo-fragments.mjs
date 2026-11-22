#!/usr/bin/env node
/**
 * Real-place fragments → game inspiration numbers. Drives the geospatial-reconstruction-engine.
 *
 *   npm run geo -- search "<query>"
 *   npm run geo -- import <slug> <lat> <lon> [--size 800] [--note "..."]
 *   npm run geo -- register <slug> <import_area_id> [--note "..."]   adopt an engine import that already exists
 *   npm run geo -- profile <slug|all> [--generate] [--today YYYY-MM-DD]
 *   npm run geo -- status
 *
 * Registry: specs/map/fragments/index.yaml (slug → import_area_id + bbox). Profiles:
 * specs/map/fragments/<slug>.yaml (deterministic: a rerun with no change is byte-identical).
 * Never imports real geometry into the game: the game reads only numbers decided in the specs.
 *
 * Engine: ENGINE_URL (default http://localhost:58000). Fingerprints of the engine's block fill are
 * stored only in its database; they are read (SELECT only) through `docker compose exec` in
 * ENGINE_REPO (default ../geospatial-reconstruction-engine). Street topology metrics come from
 * src/world/street-metrics.ts, the single definition (same as `npm run references`).
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { bboxAreaKm2Wgs84 } from './reference-sectors.mjs';
import { MAX_SIDE_M, bboxCenterSize, buildProfile, renderProfile, sameBbox, squareBbox, toYaml } from './geo-fragments-lib.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'specs/map/fragments');
const INDEX = join(DIR, 'index.yaml');
const START_HINT = [
  'Start it from ../geospatial-reconstruction-engine:',
  '  ./scripts/dev-up.sh',
  '  cd server && source .venv/bin/activate && set -a && source .env && set +a && uvicorn app.main:app --port "$APP_PORT"',
  'or point ENGINE_URL at a running instance.',
].join('\n');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

class ToolError extends Error {}

const localDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function parseArgs(argv, env) {
  const pos = [];
  const o = {
    engine: (env.ENGINE_URL || 'http://localhost:58000').replace(/\/+$/, ''),
    engineRepo: resolve(env.ENGINE_REPO || join(ROOT, '..', 'geospatial-reconstruction-engine')),
    size: 800,
    note: undefined,
    generate: false,
    today: localDate(new Date()),
    timeoutS: Number(env.GEO_IMPORT_TIMEOUT_S || 600),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (argv[i + 1] === undefined) throw new ToolError(`${a}: missing value`);
      return argv[++i];
    };
    if (a === '--size') o.size = Number(next());
    else if (a === '--note') o.note = next();
    else if (a === '--generate') o.generate = true;
    else if (a === '--today') o.today = next();
    else if (a.startsWith('--')) throw new ToolError(`unknown option ${a}`);
    else pos.push(a);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.today)) throw new ToolError('--today must be YYYY-MM-DD');
  return { cmd: pos[0], pos: pos.slice(1), o };
}

// ---------------------------------------------------------------------------------------------
// Engine client

async function http(o, path, init = {}) {
  const url = new URL(path, o.engine + '/').toString();
  try {
    return await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(120_000) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new ToolError(`${init.method || 'GET'} ${url}: no answer within 120 s`);
    const why = e?.cause?.code || e?.code || e?.message || String(e);
    throw new ToolError(`geospatial-reconstruction-engine is not answering at ${o.engine} (${why}).\n${START_HINT}`);
  }
}
async function getJson(o, path) {
  const res = await http(o, path);
  if (!res.ok) throw new ToolError(`GET ${path} → ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}
async function postJson(o, path, body) {
  const res = await http(o, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status !== 202) throw new ToolError(`POST ${path} → ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}
const listAreas = async (o) => (await getJson(o, '/import-areas')).import_areas;
const areaBbox = (a) => [a.bbox.min_longitude, a.bbox.min_latitude, a.bbox.max_longitude, a.bbox.max_latitude];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll an import area until completed (failed/timeout → error). */
async function waitImport(o, id, log) {
  const t0 = Date.now();
  let last = '';
  for (;;) {
    const a = await getJson(o, `/import-areas/${id}`);
    if (a.status !== last) log(`  ${id}: ${a.status}`);
    last = a.status;
    if (a.status === 'completed') return a;
    if (a.status === 'failed') throw new ToolError(`import ${id} failed${a.error ? `: ${JSON.stringify(a.error)}` : ''}`);
    if (Date.now() - t0 > o.timeoutS * 1000) throw new ToolError(`import ${id}: still ${a.status} after ${o.timeoutS} s (rerun \`status\` later)`);
    await sleep(2000);
  }
}

/** Follow a generation job's SSE stream until `completed` / `failed`. */
async function waitGeneration(o, eventsUrl, log) {
  const res = await http(o, eventsUrl, { headers: { accept: 'text/event-stream' }, signal: AbortSignal.timeout(o.timeoutS * 1000) });
  if (!res.ok) throw new ToolError(`GET ${eventsUrl} → ${res.status}`);
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    for (const m of buf.matchAll(/^event: (\w+)/gm)) {
      if (m[1] === 'failed') throw new ToolError(`generation failed: ${buf.slice(buf.lastIndexOf('event: failed'), buf.lastIndexOf('event: failed') + 300)}`);
      if (m[1] === 'completed') return;
    }
  }
  log('  generation stream ended without completed; checking the run');
}

// ---------------------------------------------------------------------------------------------
// Registry

function readIndex() {
  if (!existsSync(INDEX)) return {};
  const doc = load(readFileSync(INDEX, 'utf8'));
  return (doc && doc.fragments) || {};
}
function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw e;
  }
}
function writeIndex(frags) {
  const sorted = Object.fromEntries(Object.keys(frags).sort().map((k) => [k, frags[k]]));
  const head =
    '# TRÁNSITO fragments registry — slug → engine import area. Written by tools/geo-fragments.mjs (import / register).\n' +
    '# Fragments are small real-place squares (default 800 m, cap 2 km²) used as inspiration only.\n';
  writeAtomic(INDEX, head + toYaml({ fragments: sorted }) + '\n');
}
function entryFrom(area, note, size) {
  const bbox = areaBbox(area);
  const c = bboxCenterSize(bbox);
  const e = { import_area_id: area.id, place_name: area.place_name ?? null, center: [c.lat, c.lon], size_m: size ?? Math.round((c.width_m + c.height_m) / 20) * 10, bbox };
  if (note) e.note = note;
  return e;
}
const checkSlug = (s) => {
  if (!s || !SLUG.test(s)) throw new ToolError(`slug must match ${SLUG} (got ${JSON.stringify(s)})`);
};

// ---------------------------------------------------------------------------------------------
// Commands

async function cmdSearch(o, [q], log) {
  if (!q) throw new ToolError('usage: search "<query>"');
  const j = await getJson(o, `/places/search?q=${encodeURIComponent(q)}&limit=8`);
  if (!j.places?.length) return log('no places found');
  for (const p of j.places) {
    const b = p.bbox;
    const span = b ? `${Math.round((b.east - b.west) * 111195 * Math.cos((p.latitude * Math.PI) / 180))}x${Math.round((b.north - b.south) * 111195)} m` : '?';
    log(`${p.latitude.toFixed(5)} ${p.longitude.toFixed(5)}  ${p.category}/${p.type}  bbox ${span}  ${p.display_name}`);
  }
  log('\nPick a point inside, then: npm run geo -- import <slug> <lat> <lon> [--size 800]');
}

async function cmdImport(o, [slug, latS, lonS], log) {
  checkSlug(slug);
  const lat = Number(latS);
  const lon = Number(lonS);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new ToolError('usage: import <slug> <lat> <lon> [--size 800]');
  if (!(o.size > 0)) throw new ToolError('--size must be a positive number of metres');
  if (o.size > MAX_SIDE_M) throw new ToolError(`--size ${o.size} m is over ${MAX_SIDE_M} m (2 km² cap); fragments are small on purpose`);
  const bbox = squareBbox(lat, lon, o.size);
  const frags = readIndex();
  const areas = await listAreas(o);
  let area = areas.find((a) => a.provider === 'osm' && sameBbox(areaBbox(a), bbox));
  if (area) log(`reuse engine import ${area.id} (same bbox, status ${area.status})`);
  else {
    log(`POST /import-areas ${bbox.join(', ')}`);
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const s = await postJson(o, '/import-areas', { bbox: { min_latitude: minLat, min_longitude: minLon, max_latitude: maxLat, max_longitude: maxLon }, background: true });
    area = await getJson(o, `/import-areas/${s.import_area_id}`);
  }
  if (area.status !== 'completed') area = await waitImport(o, area.id, log);
  frags[slug] = entryFrom(area, o.note, o.size);
  writeIndex(frags);
  log(`registered ${slug} → ${area.id} in ${INDEX}`);
}

async function cmdRegister(o, [slug, id], log) {
  checkSlug(slug);
  if (!id || !UUID.test(id)) throw new ToolError('usage: register <slug> <import_area_id>');
  const area = await getJson(o, `/import-areas/${id}`);
  if (area.status !== 'completed') throw new ToolError(`import ${id} is ${area.status}`);
  const km2 = bboxAreaKm2Wgs84(areaBbox(area));
  if (km2 > 2.05) throw new ToolError(`import ${id} covers ${km2.toFixed(2)} km² (> 2 km² cap): not a fragment`);
  const frags = readIndex();
  frags[slug] = entryFrom(area, o.note);
  writeIndex(frags);
  log(`registered ${slug} → ${id} (${km2.toFixed(3)} km²)`);
}

/** Fingerprints of the run's exemplar blocks (SELECT only, via the engine's docker compose db). */
function readFingerprints(o, id) {
  if (!UUID.test(id)) throw new ToolError(`bad import area id ${id}`);
  const sql = `select coalesce(json_agg(f.fingerprint order by f.block_id), '[]'::json) from block_fingerprints f join generation_runs r on r.id = f.run_id where r.import_area_id = '${id}'`;
  const res = spawnSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'geodb', '-d', 'geodb', '-At', '-c', sql], { cwd: o.engineRepo, encoding: 'utf8' });
  if (res.status !== 0) return undefined;
  try {
    return JSON.parse(res.stdout.trim());
  } catch {
    return undefined;
  }
}

async function profileOne(o, slug, entry, log) {
  const id = entry.import_area_id;
  let area = await getJson(o, `/import-areas/${id}`);
  if (area.status !== 'completed') area = await waitImport(o, id, log);
  if (o.generate) {
    let run = null;
    const res = await http(o, `/import-areas/${id}/generation`);
    if (res.ok) run = await res.json();
    if (run && !run.stale) log(`  ${slug}: generation run already current (seed ${run.seed}); not regenerated`);
    else {
      log(`  ${slug}: POST generation (seed ${run?.seed ?? 'default'})`);
      const s = await postJson(o, `/import-areas/${id}/generation`, run ? {} : { seed: 1 });
      await waitGeneration(o, s.events_url, log);
    }
  }
  const mapData = await getJson(o, `/import-areas/${id}/map-data?mode=filter`);
  if (!mapData?.road_segments?.features || !mapData?.blocks?.features) throw new ToolError(`map-data of ${id}: missing road_segments/blocks`);
  const bbox = areaBbox(area);
  const fingerprints = mapData.generation ? readFingerprints(o, id) : null;
  if (mapData.generation && fingerprints === undefined) log(`  ${slug}: engine database not reachable; fill styles left unavailable`);
  const profile = buildProfile({
    fragment: { slug, import_area_id: id, bbox, place_name: area.place_name ?? entry.place_name ?? slug },
    km2: bboxAreaKm2Wgs84(bbox),
    mapData,
    fingerprints,
  });
  const path = join(DIR, `${slug}.yaml`);
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const text = renderProfile(profile, o.today, prev);
  load(text); // must parse
  if (text === prev) log(`${slug}: unchanged`);
  else {
    writeAtomic(path, text);
    log(`${slug}: written ${path}`);
  }
  return profile;
}

async function cmdProfile(o, [which], log) {
  if (!which) throw new ToolError('usage: profile <slug|all> [--generate]');
  const frags = readIndex();
  const slugs = which === 'all' ? Object.keys(frags).sort() : [which];
  if (!slugs.length) throw new ToolError('no fragments registered; use import or register first');
  for (const s of slugs) if (!frags[s]) throw new ToolError(`unknown fragment "${s}" (registered: ${Object.keys(frags).join(', ') || 'none'})`);
  for (const s of slugs) await profileOne(o, s, frags[s], log);
}

async function cmdStatus(o, _p, log) {
  const frags = readIndex();
  const slugs = Object.keys(frags).sort();
  if (!slugs.length) return log('no fragments registered');
  const areas = new Map((await listAreas(o)).map((a) => [a.id, a]));
  for (const s of slugs) {
    const e = frags[s];
    const a = areas.get(e.import_area_id);
    const profiled = existsSync(join(DIR, `${s}.yaml`)) ? 'profiled' : 'not profiled';
    log(`${s.padEnd(18)} ${(a?.status ?? 'missing in engine').padEnd(10)} ${profiled.padEnd(13)} ${e.size_m} m  ${e.place_name ?? ''}  ${e.import_area_id}`);
  }
}

const COMMANDS = { search: cmdSearch, import: cmdImport, register: cmdRegister, profile: cmdProfile, status: cmdStatus };

export async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const { cmd, pos, o } = parseArgs(argv, env);
  const fn = COMMANDS[cmd];
  if (!fn) throw new ToolError(`usage: npm run geo -- <${Object.keys(COMMANDS).join('|')}> ... (see header of tools/geo-fragments.mjs)`);
  await fn(o, pos, log);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    if (e instanceof ToolError || e?.name === 'WorldSpecError') console.error(`geo: ${e.message}`);
    else console.error(e);
    process.exit(1);
  });
}
