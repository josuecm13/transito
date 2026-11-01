#!/usr/bin/env node
/**
 * Reference sectors → frozen street metrics (issue #7, card S2b).
 *
 *   npm run references
 *   node tools/reference-sectors.mjs [--world specs/map/world.yaml] [--metrics specs/map/street-metrics.yaml]
 *                                    [--import-timeout <seconds>] [--today YYYY-MM-DD]
 *
 * For every sector in world.yaml `street_styles.districts.*.reference`:
 *   1. resolve its bbox (`bbox`, or `place` + `size_m` via GET /places/search; a place sector whose
 *      place/size are unchanged reuses the bbox already frozen in street-metrics.yaml);
 *   2. REUSE the engine's import area if GET /import-areas lists one with that id
 *      (`import_area_id`) or with exactly those four bounds — no POST in that case, because a
 *      repeated POST re-fetches Overpass and re-imports;
 *   3. otherwise POST /import-areas {bbox, background: true} and follow the SSE `events_url` until
 *      `completed` / `failed` (timeout: --import-timeout, env REFERENCES_IMPORT_TIMEOUT_S, 600 s);
 *   4. GET /import-areas/{id}/map-data?mode=filter (whole segments, the scope of the reference SQL)
 *      and compute metrics with src/world/street-metrics.ts (the single metric definition).
 * Then `references:` in street-metrics.yaml is rewritten (header comments, `query` and `band` are
 * kept byte for byte), atomically (temp file + rename), only after every sector succeeded.
 *
 * km2 = WGS84 ellipsoidal area of the lon/lat box (parallels + meridians), which reproduces the
 * frozen PostGIS `st_area(bbox::geography)` to ~1e-8 relative. `bboxKm2` in src/world/spec.ts (a
 * local equirectangular approximation, used by the validator's 2 km² cap) differs by ~0.4% at
 * these latitudes, which would shift the per-km² metrics; it is not used here.
 *
 * Engine: ENGINE_URL (default http://localhost:58000). Zero dependencies beyond the repo's own.
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { parseWorldSpec } from '../src/world/spec.ts';
import { computeStreetMetrics, mapDataToMetricsInput } from '../src/world/street-metrics.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ATTRIBUTION = '© OpenStreetMap contributors';
const METHOD = 'map-data';
const METRIC_KEYS = [
  'blocks_measured',
  'block_area_p10_m2',
  'block_area_median_m2',
  'block_area_p90_m2',
  'dead_end_share',
  't_share',
  'x_share',
  'intersections_per_km2',
  'street_km_per_km2',
  'mean_segment_m',
];
const START_HINT = [
  'Start it from ../geospatial-reconstruction-engine:',
  '  ./scripts/dev-up.sh',
  '  cd server && source .venv/bin/activate && set -a && source .env && set +a && uvicorn app.main:app --port "$APP_PORT"',
  'or point ENGINE_URL at a running instance.',
].join('\n');

class ToolError extends Error {}

// ---------------------------------------------------------------------------------------------
// CLI

/** YYYY-MM-DD in the local time zone (toISOString would give the UTC date). */
function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseArgs(argv, env) {
  const opts = {
    world: join(ROOT, 'specs/map/world.yaml'),
    metrics: join(ROOT, 'specs/map/street-metrics.yaml'),
    engine: (env.ENGINE_URL || 'http://localhost:58000').replace(/\/+$/, ''),
    importTimeoutS: Number(env.REFERENCES_IMPORT_TIMEOUT_S || 600),
    requestTimeoutS: Number(env.REFERENCES_REQUEST_TIMEOUT_S || 120),
    today: localDate(new Date()),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new ToolError(`${a}: missing value`);
      return v;
    };
    if (a === '--world') opts.world = resolve(next());
    else if (a === '--metrics') opts.metrics = resolve(next());
    else if (a === '--import-timeout') opts.importTimeoutS = Number(next());
    else if (a === '--today') opts.today = next();
    else throw new ToolError(`unknown argument ${a}`);
  }
  if (!(opts.importTimeoutS > 0)) throw new ToolError('import timeout must be a positive number of seconds');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.today)) throw new ToolError('--today must be YYYY-MM-DD');
  return opts;
}

// ---------------------------------------------------------------------------------------------
// Geometry

/** WGS84 ellipsoidal area (km²) of [min_lon, min_lat, max_lon, max_lat] bounded by parallels. */
export function bboxAreaKm2Wgs84([minLon, minLat, maxLon, maxLat]) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = f * (2 - f);
  const e = Math.sqrt(e2);
  const q = (phi) => {
    const s = Math.sin(phi);
    return s / (1 - e2 * s * s) + (1 / (2 * e)) * Math.log((1 + e * s) / (1 - e * s));
  };
  const rad = Math.PI / 180;
  return (((maxLon - minLon) * rad * b * b) / 2) * (q(maxLat * rad) - q(minLat * rad)) / 1e6;
}

const round7 = (v) => Math.round(v * 1e7) / 1e7;

/** Square of side `sizeM` centred on (lat, lon), rounded to 1e-7° (OSM precision). */
function squareBbox(lat, lon, sizeM) {
  const R = 6371008.8;
  const dLat = ((sizeM / 2) / R) * (180 / Math.PI);
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return [round7(lon - dLon), round7(lat - dLat), round7(lon + dLon), round7(lat + dLat)];
}

const areaBbox = (area) => [
  area.bbox.min_longitude,
  area.bbox.min_latitude,
  area.bbox.max_longitude,
  area.bbox.max_latitude,
];
const sameBbox = (a, b) => a.length === 4 && b.length === 4 && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------------------------
// Engine client

function engineDown(engine, cause) {
  const why = cause?.cause?.code || cause?.code || cause?.message || String(cause);
  return new ToolError(`geospatial-reconstruction-engine is not answering at ${engine} (${why}).\n${START_HINT}`);
}

async function request(opts, path, init = {}) {
  const url = new URL(path, opts.engine + '/').toString();
  let res;
  try {
    res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(opts.requestTimeoutS * 1000) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new ToolError(`${init.method || 'GET'} ${url}: no answer within ${opts.requestTimeoutS} s`);
    throw engineDown(opts.engine, e);
  }
  return res;
}

async function errorText(res) {
  const body = await res.text().catch(() => '');
  try {
    const j = JSON.parse(body);
    if (j?.error) return `${j.error.code}: ${j.error.message}`;
  } catch {
    /* not JSON */
  }
  return body.slice(0, 300) || res.statusText;
}

async function getJson(opts, path) {
  const res = await request(opts, path);
  if (!res.ok) throw new ToolError(`GET ${path} → ${res.status} ${await errorText(res)}`);
  return res.json();
}

/** Parses an SSE byte stream; yields {id, event, data} per dispatched event, skipping comments. */
async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let buf = '';
  let ev = { id: undefined, event: 'message', data: [] };
  const flushLine = function* (line) {
    if (line === '') {
      if (ev.data.length > 0) yield { id: ev.id, event: ev.event, data: ev.data.join('\n') };
      ev = { id: undefined, event: 'message', data: [] };
      return;
    }
    if (line.startsWith(':')) return;
    const c = line.indexOf(':');
    const field = c < 0 ? line : line.slice(0, c);
    let value = c < 0 ? '' : line.slice(c + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') ev.event = value;
    else if (field === 'data') ev.data.push(value);
    else if (field === 'id') ev.id = value;
  };
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let m;
    while ((m = /\r\n|\r|\n/.exec(buf))) {
      // A lone trailing \r may be the first half of \r\n: wait for more input.
      if (m[0] === '\r' && m.index === buf.length - 1) break;
      const line = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      yield* flushLine(line);
    }
  }
  buf += decoder.decode();
  if (buf) yield* flushLine(buf);
  yield* flushLine('');
}

async function followImport(opts, id, eventsUrl, log) {
  const ms = opts.importTimeoutS * 1000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    let res;
    try {
      res = await fetch(new URL(eventsUrl, opts.engine + '/'), {
        headers: { accept: 'text/event-stream' },
        signal: ctrl.signal,
      });
    } catch (e) {
      if (ctrl.signal.aborted) throw new ToolError(`import ${id}: timed out after ${opts.importTimeoutS} s`);
      throw engineDown(opts.engine, e);
    }
    if (res.status === 404) {
      // No job in memory (finished long ago or the engine restarted): trust the stored status.
      res.body?.cancel();
      const area = await findArea(opts, id);
      if (area?.status === 'completed') return area;
      throw new ToolError(`import ${id}: no running job and status is ${area?.status ?? 'unknown'}`);
    }
    if (!res.ok) throw new ToolError(`GET ${eventsUrl} → ${res.status} ${await errorText(res)}`);
    try {
      for await (const e of sseEvents(res.body)) {
        let data;
        try {
          data = JSON.parse(e.data);
        } catch {
          data = e.data;
        }
        if (e.event === 'completed') return data;
        if (e.event === 'failed') {
          const d = data && typeof data === 'object' ? data : {};
          throw new ToolError(`import ${id} failed: ${d.code ?? 'error'}: ${d.message ?? e.data}`);
        }
        log(`    ${e.event}`);
      }
    } catch (e) {
      if (e instanceof ToolError) throw e;
      if (ctrl.signal.aborted) throw new ToolError(`import ${id}: timed out after ${opts.importTimeoutS} s`);
      throw new ToolError(`import ${id}: event stream broke (${e?.message ?? e})`);
    }
    const area = await findArea(opts, id);
    if (area?.status === 'completed') return area;
    throw new ToolError(`import ${id}: event stream ended without completed/failed (status ${area?.status ?? 'unknown'})`);
  } finally {
    clearTimeout(timer);
  }
}

async function listAreas(opts) {
  const j = await getJson(opts, '/import-areas');
  if (!Array.isArray(j?.import_areas)) throw new ToolError('GET /import-areas: unexpected response shape');
  return j.import_areas;
}

async function findArea(opts, id) {
  return (await listAreas(opts)).find((a) => a.id === id);
}

async function resolveBbox(opts, sector, previous) {
  if (sector.bbox) return { bbox: [...sector.bbox] };
  if (previous && previous.place === sector.place && previous.size_m === sector.sizeM && Array.isArray(previous.bbox)) {
    return { bbox: previous.bbox.map(Number) };
  }
  const j = await getJson(opts, `/places/search?q=${encodeURIComponent(sector.place)}&limit=1`);
  const p = j?.places?.[0];
  if (!p) throw new ToolError(`sector "${sector.name}": /places/search found nothing for "${sector.place}"`);
  return { bbox: squareBbox(p.latitude, p.longitude, sector.sizeM), placeName: p.name || p.display_name };
}

async function obtainArea(opts, sector, bbox, log, stats) {
  const areas = await listAreas(opts);
  let area = sector.importAreaId
    ? areas.find((a) => a.id === sector.importAreaId)
    : areas.find((a) => a.provider === 'osm' && sameBbox(areaBbox(a), bbox));
  if (sector.importAreaId && !area) {
    throw new ToolError(`sector "${sector.name}": pinned import_area_id ${sector.importAreaId} is not in the engine`);
  }
  if (area?.status === 'completed') {
    log(`  reuse ${area.id} (${area.place_name ?? 'unnamed'})`);
    return area;
  }
  if (area && (area.status === 'pending' || area.status === 'importing')) {
    log(`  ${area.id} is ${area.status}: following its events`);
    return followImport(opts, area.id, `/import-areas/${area.id}/events`, log);
  }
  if (sector.importAreaId) {
    throw new ToolError(`sector "${sector.name}": pinned area ${area.id} has status ${area.status}; pinned areas are never re-requested`);
  }
  const [minLon, minLat, maxLon, maxLat] = bbox;
  log(`  POST /import-areas (${bbox.join(', ')})`);
  stats.posts++;
  const res = await request(opts, '/import-areas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bbox: { min_latitude: minLat, min_longitude: minLon, max_latitude: maxLat, max_longitude: maxLon },
      background: true,
    }),
  });
  if (res.status !== 202) throw new ToolError(`POST /import-areas → ${res.status} ${await errorText(res)}`);
  const started = await res.json();
  const done = await followImport(opts, started.import_area_id, started.events_url, log);
  return (await findArea(opts, started.import_area_id)) ?? done;
}

// ---------------------------------------------------------------------------------------------
// YAML output

function num(v) {
  if (!Number.isFinite(v)) throw new ToolError(`non-finite number ${v}`);
  return String(v);
}
const quote = (s) => JSON.stringify(String(s));

function renderReferences(refs) {
  const out = ['references:'];
  for (const r of refs) {
    out.push(`  ${quoteKey(r.name)}:`);
    out.push(`    place_name: ${quote(r.place_name)}`);
    out.push(`    import_area_id: ${r.import_area_id}`);
    out.push(`    bbox: [${r.bbox.map(num).join(', ')}]`);
    if (r.place !== undefined) {
      out.push(`    place: ${quote(r.place)}`);
      out.push(`    size_m: ${num(r.size_m)}`);
    }
    out.push(`    km2: ${num(r.km2)}`);
    out.push(`    extracted: ${quote(r.extracted)}`);
    out.push(`    source: ${quote(r.source)}`);
    out.push(`    attribution: ${quote(ATTRIBUTION)}`);
    out.push(`    method: ${METHOD}`);
    out.push('    metrics:');
    for (const k of METRIC_KEYS) out.push(`      ${k}: ${num(r.metrics[k])}`);
  }
  return out.join('\n') + '\n';
}

const quoteKey = (s) => (/^[A-Za-z][A-Za-z0-9 _.-]*$/.test(s) && !/\s$/.test(s) ? s : quote(s));

/** Replace the top-level `references:` block (up to the next column-0 line) in `text`. */
function spliceReferences(text, block) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^references:\s*$/.test(l));
  if (start < 0) throw new ToolError('street-metrics.yaml: no top-level "references:" line');
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
  // Keep the blank lines that separate the block from what follows.
  let blockEnd = end;
  while (blockEnd > start + 1 && lines[blockEnd - 1] === '') blockEnd--;
  const before = lines.slice(0, start).join('\n');
  const after = lines.slice(blockEnd).join('\n');
  return (before ? before + '\n' : '') + block + after;
}

function sameValues(prev, next) {
  if (!prev || typeof prev !== 'object' || !prev.metrics) return false;
  if (prev.method !== METHOD || prev.import_area_id !== next.import_area_id) return false;
  if (prev.km2 !== next.km2 || !Array.isArray(prev.bbox) || !sameBbox(prev.bbox, next.bbox)) return false;
  return METRIC_KEYS.every((k) => prev.metrics[k] === next.metrics[k]);
}

function writeAtomic(path, content) {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const opts = parseArgs(argv, env);
  const world = parseWorldSpec(readFileSync(opts.world, 'utf8'));
  const metricsText = readFileSync(opts.metrics, 'utf8');
  const prevDoc = load(metricsText);
  const prevRefs = (prevDoc && typeof prevDoc === 'object' && prevDoc.references) || {};

  const sectors = [];
  const seen = new Set();
  for (const d of Object.values(world.streetStyles.districts)) {
    for (const s of d.reference) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      sectors.push(s);
    }
  }

  const stats = { posts: 0 };
  const refs = [];
  for (const sector of sectors) {
    log(`${sector.name}`);
    const prev = prevRefs[sector.name];
    const { bbox: wanted, placeName } = await resolveBbox(opts, sector, prev);
    const area = await obtainArea(opts, sector, wanted, log, stats);
    const id = area.id;
    const bbox = areaBbox(area);
    const km2 = bboxAreaKm2Wgs84(bbox);
    const source = `geospatial-reconstruction-engine GET /import-areas/${id}/map-data?mode=filter`;
    const mapData = await getJson(opts, `/import-areas/${id}/map-data?mode=filter`);
    if (!mapData?.road_segments?.features || !mapData?.blocks?.features) {
      throw new ToolError(`map-data of ${id}: missing road_segments/blocks feature collections`);
    }
    const metrics = computeStreetMetrics(mapDataToMetricsInput(mapData, km2));
    const ref = {
      name: sector.name,
      place_name: area.place_name ?? placeName ?? sector.name,
      import_area_id: id,
      bbox,
      km2,
      source,
      metrics,
    };
    if (sector.place !== undefined) {
      ref.place = sector.place;
      ref.size_m = sector.sizeM;
    }
    ref.extracted = sameValues(prev, ref) && typeof prev.extracted === 'string' ? prev.extracted : opts.today;
    refs.push(ref);
    log(`  ${METRIC_KEYS.map((k) => `${k}=${+metrics[k].toFixed(4)}`).join(' ')}`);
  }

  const next = spliceReferences(metricsText, renderReferences(refs));
  load(next); // must still parse
  if (next === metricsText) log(`${opts.metrics}: unchanged`);
  else {
    writeAtomic(opts.metrics, next);
    log(`${opts.metrics}: rewritten`);
  }
  log(`POST requests: ${stats.posts}`);
  return stats;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    if (e instanceof ToolError || e?.name === 'WorldSpecError') {
      console.error(`reference-sectors: ${e.message}${e.problems ? '\n  ' + e.problems.join('\n  ') : ''}`);
    } else {
      console.error(e);
    }
    process.exit(1);
  });
}
