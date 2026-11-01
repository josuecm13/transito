/**
 * tools/reference-sectors.mjs against a fake geospatial-reconstruction-engine (local HTTP server on
 * port 0, no network, no database). Works on temp copies of the spec files, never the real ones.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { load } from 'js-yaml';

const ROOT = join(import.meta.dirname, '..');
const TOOL = join(ROOT, 'tools', 'reference-sectors.mjs');
const FIXTURES = join(import.meta.dirname, 'fixtures', 'street-refs');

type Fixture = {
  import_area_id: string;
  place_name: string;
  road_segments: [string, string, number][];
  blocks: [number, boolean, boolean][];
};
const fixture = (name: string): Fixture => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

function toMapData(f: Fixture) {
  return {
    projection: { origin: { latitude: 0, longitude: 0 } },
    road_segments: {
      type: 'FeatureCollection',
      features: f.road_segments.map(([from_node_id, to_node_id, distance_meters]) => ({
        type: 'Feature',
        geometry: null,
        properties: { from_node_id, to_node_id, distance_meters },
      })),
    },
    blocks: {
      type: 'FeatureCollection',
      features: f.blocks.map(([area_square_meters, is_median, is_clipped]) => ({
        type: 'Feature',
        geometry: null,
        properties: { area_square_meters, is_median, is_clipped },
      })),
    },
    buildings: { type: 'FeatureCollection', features: [] },
    area_features: { type: 'FeatureCollection', features: [] },
  };
}

// The two areas the real engine already stores (same bboxes as world.yaml).
const LA_CARPIO = fixture('la-carpio');
const SANTA_ANA = fixture('santa-ana');
const SEEDED = [
  { f: LA_CARPIO, bbox: [-84.1560494, 9.9581759, -84.1430313, 9.9666528], context: 'San José, Costa Rica' },
  { f: SANTA_ANA, bbox: [-79.5511906, 8.9461305, -79.5203161, 8.9723801], context: 'Panamá' },
];
// A new, unpinned sector (~0.9 km²) the fake engine does not know yet.
const NEW_BBOX = [-79.4800000, 9.0600000, -79.4713000, 9.0686000];
const NEW_SECTOR = `        - name: Sector Nuevo
          bbox: [${NEW_BBOX.join(', ')}]
          note: "test sector"
`;

type Area = {
  id: string;
  provider: string;
  bbox: { min_latitude: number; min_longitude: number; max_latitude: number; max_longitude: number };
  status: string;
  place_name: string | null;
  place_context: string | null;
  mapData: ReturnType<typeof toMapData>;
};

class FakeEngine {
  server!: Server;
  url = '';
  areas: Area[] = [];
  posts = 0;
  requests: string[] = [];
  /** Terminal event for the next background import. */
  outcome: 'completed' | 'failed' = 'completed';

  reset() {
    this.posts = 0;
    this.requests = [];
    this.outcome = 'completed';
    this.areas = SEEDED.map(({ f, bbox, context }) => ({
      id: f.import_area_id,
      provider: 'osm',
      bbox: { min_longitude: bbox[0]!, min_latitude: bbox[1]!, max_longitude: bbox[2]!, max_latitude: bbox[3]! },
      status: 'completed',
      place_name: f.place_name,
      place_context: context,
      mapData: toMapData(f),
    }));
  }

  out(a: Area) {
    const { mapData: _m, ...rest } = a;
    return { ...rest, road_count: 0, node_count: 0, block_count: a.mapData.blocks.features.length };
  }

  async start() {
    this.reset();
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url ?? '/', 'http://x');
    this.requests.push(`${req.method} ${u.pathname}${u.search}`);
    let body = '';
    for await (const c of req) body += c;
    const m = u.pathname.match(/^\/import-areas\/([^/]+)\/(events|map-data)$/);
    if (req.method === 'GET' && u.pathname === '/import-areas') {
      return this.json(res, 200, { import_areas: this.areas.map((a) => this.out(a)) });
    }
    if (req.method === 'POST' && u.pathname === '/import-areas') {
      this.posts++;
      const b = JSON.parse(body).bbox;
      const id = randomUUID();
      this.areas.push({
        id,
        provider: 'osm',
        bbox: b,
        status: 'importing',
        place_name: null,
        place_context: null,
        mapData: toMapData(LA_CARPIO),
      });
      return this.json(res, 202, { import_area_id: id, events_url: `/import-areas/${id}/events` });
    }
    if (req.method === 'GET' && m?.[2] === 'events') {
      const a = this.areas.find((x) => x.id === m[1]);
      if (!a || a.status !== 'importing') {
        return this.json(res, 404, { error: { code: 'import_job_not_found', message: 'no job', details: {} } });
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      let n = 0;
      const send = (stage: string, data: unknown) => res.write(`id: ${++n}\nevent: ${stage}\ndata: ${JSON.stringify(data)}\n\n`);
      send('fetched', { elements: 10 });
      res.write(': keep-alive\n\n');
      send('ground', {});
      // Split one event across two writes, with CRLF line endings, to exercise the parser.
      res.write(`id: ${++n}\r\nevent: roads\r\n`);
      await new Promise((r) => setTimeout(r, 20));
      res.write(`data: {"road_count":5}\r\n\r\n`);
      send('blocks', {});
      send('buildings', { done: 1 });
      send('buildings', { done: 2 });
      send('elevation', {});
      if (this.outcome === 'failed') {
        a.status = 'failed';
        send('failed', { code: 'source_incomplete', message: 'Overpass gave up', details: {} });
      } else {
        a.status = 'completed';
        a.place_name = 'Barrio Nuevo';
        send('completed', this.out(a));
      }
      return res.end();
    }
    if (req.method === 'GET' && m?.[2] === 'map-data') {
      const a = this.areas.find((x) => x.id === m[1]);
      if (!a) return this.json(res, 404, { error: { code: 'not_found', message: 'no area', details: {} } });
      assert.equal(u.searchParams.get('mode'), 'filter');
      return this.json(res, 200, a.mapData);
    }
    if (req.method === 'GET' && u.pathname === '/places/search') {
      return this.json(res, 200, {
        places: [{ display_name: 'Lugar, Panamá', name: 'Lugar', latitude: 9.06, longitude: -79.47, bbox: { south: 9, west: -80, north: 10, east: -79 }, category: 'place', type: 'suburb' }],
      });
    }
    return this.json(res, 404, { error: { code: 'not_found', message: u.pathname, details: {} } });
  }
}

const engine = new FakeEngine();
let tmp = '';

before(async () => {
  await engine.start();
});
after(() => {
  engine.server.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** Fresh temp copies of world.yaml + street-metrics.yaml; optionally add the new sector. */
function workspace(withNewSector = false) {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = mkdtempSync(join(tmpdir(), 'refsectors-'));
  const world = join(tmp, 'world.yaml');
  const metrics = join(tmp, 'street-metrics.yaml');
  copyFileSync(join(ROOT, 'specs/map/world.yaml'), world);
  copyFileSync(join(ROOT, 'specs/map/street-metrics.yaml'), metrics);
  if (withNewSector) {
    const text = readFileSync(world, 'utf8');
    const anchor = '          note: "San José, Costa Rica — barrio informal"\n';
    assert.ok(text.includes(anchor), 'world.yaml anchor for the test sector moved');
    writeFileSync(world, text.replace(anchor, anchor + NEW_SECTOR));
  }
  return { world, metrics };
}

function run(ws: { world: string; metrics: string }, engineUrl = engine.url) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(process.execPath, [TOOL, '--world', ws.world, '--metrics', ws.metrics, '--today', '2026-11-01', '--import-timeout', '20'], {
      env: { ...process.env, ENGINE_URL: engineUrl },
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

type Ref = { import_area_id: string; method: string; km2: number; extracted: string; attribution: string; bbox: number[]; place_name: string; metrics: Record<string, number> };
const refsOf = (path: string) => (load(readFileSync(path, 'utf8')) as { references: Record<string, Ref> }).references;

test('(a) existing areas are reused: zero POSTs, map-data metrics with provenance', async () => {
  engine.reset();
  const ws = workspace();
  // Start from SQL-frozen entries (as before the first real run), whatever the real file holds now:
  // the method changes, so the extraction date must move to today.
  writeFileSync(ws.metrics, readFileSync(ws.metrics, 'utf8').replaceAll('    method: map-data\n', '    method: sql\n'));
  const original = readFileSync(ws.metrics, 'utf8');
  const r = await run(ws);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(engine.posts, 0, engine.requests.join('\n'));
  assert.ok(engine.requests.includes(`GET /import-areas/${LA_CARPIO.import_area_id}/map-data?mode=filter`));

  const text = readFileSync(ws.metrics, 'utf8');
  // Header comments, query and band survive byte for byte.
  const head = (s: string) => s.slice(0, s.indexOf('\nreferences:'));
  const tail = (s: string) => s.slice(s.indexOf('# Realism band'));
  assert.equal(head(text), head(original));
  assert.equal(tail(text), tail(original));

  const refs = refsOf(ws.metrics);
  const lc = refs['La Carpio']!;
  assert.equal(lc.method, 'map-data');
  assert.equal(lc.import_area_id, LA_CARPIO.import_area_id);
  assert.equal(lc.attribution, '© OpenStreetMap contributors');
  assert.deepEqual(lc.bbox, SEEDED[0]!.bbox);
  assert.equal(lc.place_name, 'La Carpio');
  assert.equal(lc.extracted, '2026-11-01');
  // km2 reproduces PostGIS st_area(bbox::geography).
  assert.ok(Math.abs(lc.km2 - 1.338399067394495) / 1.338399067394495 < 1e-6, String(lc.km2));
  assert.ok(Math.abs(refs['Santa Ana']!.km2 - 9.857293894808292) / 9.857293894808292 < 1e-6);
  // And the metrics agree with the frozen SQL values (issue #7 Evidence).
  assert.equal(lc.metrics.blocks_measured, 53);
  assert.ok(Math.abs(lc.metrics.intersections_per_km2! - 156.904) / 156.904 < 0.02);
  assert.ok(Math.abs(lc.metrics.t_share! - 0.6) <= 0.01);
});

test('(b) new sector: one POST, events followed to completed', async () => {
  engine.reset();
  const ws = workspace(true);
  const r = await run(ws);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(engine.posts, 1, engine.requests.join('\n'));
  const created = engine.areas.at(-1)!;
  assert.equal(created.status, 'completed');
  assert.ok(engine.requests.includes(`GET /import-areas/${created.id}/events`));
  for (const stage of ['fetched', 'roads', 'buildings', 'elevation']) assert.match(r.stdout, new RegExp(`\\b${stage}\\b`));
  const ref = refsOf(ws.metrics)['Sector Nuevo']!;
  assert.equal(ref.import_area_id, created.id);
  assert.equal(ref.place_name, 'Barrio Nuevo');
  assert.deepEqual(ref.bbox, NEW_BBOX);
  assert.equal(ref.method, 'map-data');
});

test('(c) idempotent: a second run makes zero POSTs and leaves the YAML byte-identical', async () => {
  engine.reset();
  const ws = workspace(true);
  const first = await run(ws);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(engine.posts, 1);
  const once = readFileSync(ws.metrics);
  engine.posts = 0;
  const second = await run(ws);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(engine.posts, 0, 'second run must reuse the area created by the first');
  assert.ok(readFileSync(ws.metrics).equals(once), 'YAML changed on the second run');
  assert.match(second.stdout, /unchanged/);
});

test('(c2) extracted date is kept when the values do not change', async () => {
  engine.reset();
  const ws = workspace();
  assert.equal((await run(ws)).code, 0);
  const text = readFileSync(ws.metrics, 'utf8');
  writeFileSync(ws.metrics, text.replaceAll('extracted: "2026-11-01"', 'extracted: "2026-10-31"'));
  const before = readFileSync(ws.metrics);
  assert.equal((await run(ws)).code, 0);
  assert.ok(readFileSync(ws.metrics).equals(before));
});

test('(d) engine down: non-zero exit with the start-up hint, YAML untouched', async () => {
  const ws = workspace();
  const original = readFileSync(ws.metrics);
  // Grab a free port, then close it so nothing listens there.
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  const r = await run(ws, `http://127.0.0.1:${port}`);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /not answering/);
  assert.match(r.stderr, /scripts\/dev-up\.sh/);
  assert.match(r.stderr, /uvicorn app\.main:app/);
  assert.ok(readFileSync(ws.metrics).equals(original));
});

test('(e) failed SSE event: non-zero exit, YAML untouched', async () => {
  engine.reset();
  engine.outcome = 'failed';
  const ws = workspace(true);
  const original = readFileSync(ws.metrics);
  const r = await run(ws);
  assert.notEqual(r.code, 0);
  assert.equal(engine.posts, 1);
  assert.match(r.stderr, /failed: source_incomplete: Overpass gave up/);
  assert.ok(readFileSync(ws.metrics).equals(original));
});
