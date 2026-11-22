/**
 * Pure part of `npm run refs` (tools/bake-refs.mjs): Overpass JSON -> simplified reference polylines,
 * metrics and the overlay SVG. No I/O, no clock (dates are passed in), so tests feed recorded fixtures.
 *
 * Determinism: features sorted by OSM id, object keys sorted on output, coordinates rounded to 5
 * decimals (~1 m). A rerun on the same Overpass data is byte-identical.
 * Data: (c) OpenStreetMap contributors, ODbL. Reference only: never fetched or read at runtime.
 */
import type { Vec2, Warp } from './warp-lib.ts';
import { LAT_M, LON_M, toMetres, outsideLand } from './warp-lib.ts';

export const ATTRIBUTION = '© OpenStreetMap contributors';
export const LICENCE = 'ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)';
export const SOURCE = 'Overpass API (https://overpass-api.de/api/interpreter), OpenStreetMap data';
export const SIMPLIFY_M = 20;
const SIMPLIFY_BY_ID: Record<string, number> = { 'gatun-lake': 80 };

export type Bbox = [number, number, number, number]; // south, west, north, east

export interface OverpassElement {
  type: 'way' | 'relation' | 'node';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; ref: number; geometry?: { lat: number; lon: number }[] }[];
}
export interface OverpassJson {
  elements: OverpassElement[];
}

export interface RefFeature {
  id: number;
  name?: string;
  ref?: string;
  kind: string; // highway=*, waterway=*, aeroway=*, natural=water ...
  role?: 'link' | 'ring';
  coords: [number, number][]; // [lon, lat], 5 decimals
}
export interface RefFile {
  id: string;
  title: string;
  provenance: {
    source: string;
    query: string;
    date: string;
    licence: string;
    attribution: string;
    bbox: Bbox;
    simplify_m: number;
    note: string;
  };
  features: RefFeature[];
}

export interface RefSpec {
  id: string;
  title: string;
  bbox: Bbox;
  /** Overpass QL, `[bbox]` is substituted by the bbox. Must end with `out geom;`. */
  query: string;
  /** Names (waterway refs) to keep, when the query is broader. */
  note: string;
  group?: 'pacific' | 'atlantic';
}

// ---------------------------------------------------------------- geometry helpers (real metric frame)

const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;

/** Douglas-Peucker in the real metric frame (equirectangular metres). */
export function simplifyDP(coords: [number, number][], tolM: number): [number, number][] {
  if (coords.length <= 2) return coords.slice();
  const pts = coords.map(([lon, lat]) => toMetres(lon, lat));
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = tolM;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i]!, pts[a]!, pts[b]!);
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function lengthM(coords: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = toMetres(coords[i - 1]![0], coords[i - 1]![1]), b = toMetres(coords[i]![0], coords[i]![1]);
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}
const chordM = (a: [number, number], b: [number, number]): number => {
  const p = toMetres(a[0], a[1]), q = toMetres(b[0], b[1]);
  return Math.hypot(q[0] - p[0], q[1] - p[1]);
};

const geom = (g: { lat: number; lon: number }[]): [number, number][] => g.map((p) => [round5(p.lon), round5(p.lat)]);

/** Join ways of a relation into closed rings (outer members), by shared end coordinates. */
export function assembleRings(ways: [number, number][][]): [number, number][][] {
  const key = (p: [number, number]): string => `${p[0]},${p[1]}`;
  const pool = ways.map((w) => w.slice());
  const rings: [number, number][][] = [];
  while (pool.length) {
    let cur = pool.shift()!;
    for (let guard = 0; guard < 10000 && key(cur[0]!) !== key(cur[cur.length - 1]!); guard++) {
      const end = key(cur[cur.length - 1]!);
      const i = pool.findIndex((w) => key(w[0]!) === end || key(w[w.length - 1]!) === end);
      if (i < 0) break;
      const w = pool.splice(i, 1)[0]!;
      cur = key(w[0]!) === end ? cur.concat(w.slice(1)) : cur.concat(w.slice(0, -1).reverse());
    }
    if (cur.length >= 4 && key(cur[0]!) === key(cur[cur.length - 1]!)) rings.push(cur);
  }
  return rings;
}

export function bakeRef(spec: RefSpec, data: OverpassJson, date: string): RefFile {
  const tol = SIMPLIFY_BY_ID[spec.id] ?? SIMPLIFY_M;
  const features: RefFeature[] = [];
  const kindOf = (t: Record<string, string>): string =>
    t.highway ? `highway=${t.highway}` : t.waterway ? `waterway=${t.waterway}` : t.aeroway ? `aeroway=${t.aeroway}` : t.natural ? `natural=${t.natural}` : 'other';
  const base = (e: OverpassElement): Omit<RefFeature, 'coords'> => {
    const t = e.tags ?? {};
    const f: Omit<RefFeature, 'coords'> = { id: e.id, kind: kindOf(t) };
    if (t.name) f.name = t.name;
    if (t.ref) f.ref = t.ref;
    if (/_link$/.test(t.highway ?? '')) f.role = 'link';
    return f;
  };
  for (const e of data.elements) {
    if (e.type === 'way' && e.geometry && e.geometry.length >= 2) {
      features.push({ ...base(e), coords: simplifyDP(geom(e.geometry), tol) });
    } else if (e.type === 'relation' && e.members) {
      const outer = e.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => geom(m.geometry!));
      // Ring ids derive from the relation id and the ring rank (largest first), stable on reruns.
      const rings = assembleRings(outer).sort((a, b) => b.length - a.length || a[0]![0] - b[0]![0] || a[0]![1] - b[0]![1]);
      rings.forEach((r, i) => features.push({ ...base(e), id: e.id * 1000 + i, role: 'ring', coords: simplifyDP(r, tol) }));
    }
  }
  features.sort((a, b) => a.id - b.id);
  return {
    id: spec.id,
    title: spec.title,
    provenance: {
      source: SOURCE,
      query: spec.query.replace(/\[bbox\]/g, `(${spec.bbox.join(',')})`),
      date,
      licence: LICENCE,
      attribution: ATTRIBUTION,
      bbox: spec.bbox,
      simplify_m: tol,
      note: spec.note,
    },
    features,
  };
}

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;

/** Sorted keys, one feature per line (diff friendly), trailing newline. */
export function serializeRef(ref: RefFile): string {
  const { features, ...rest } = ref;
  const head = JSON.stringify(sortKeys(rest));
  return `${head.slice(0, -1)},"features":[\n${features.map((f) => JSON.stringify(sortKeys(f))).join(',\n')}\n]}\n`;
}

// ---------------------------------------------------------------- reference catalogue

const B_CITY: Bbox = [8.85, -79.75, 9.15, -79.25];
const B_ISTHMUS: Bbox = [8.85, -80.05, 9.45, -79.25];
const linkQ = (inner: string, bbox: string): string =>
  `[out:json][timeout:90];\n(${inner})->.m;\nnode(w.m)->.n;\nway(bn.n)["highway"~"_link$"]->.l;\n(.m;.l;);\nout geom;`.replace(/\[bbox\]/g, bbox);

export const RIVER_NAMES = {
  pacific: ['Río Matasnillo', 'Río Curundú', 'Río Abajo', 'Río Juan Díaz', 'Río Matías Hernández', 'Río Tapia', 'Río Tocumen', 'Río Las Lajas', 'Río Pacora', 'Río Cabra', 'Río Caimito'],
  atlantic: ['Río Chagres', 'Río Gatún', 'Río Indio', 'Río Coco Solo', 'Río Chilibre', 'Río Boquerón'],
};
const riverQ = (names: string[], bbox: string): string =>
  `[out:json][timeout:90];\nway["waterway"="river"]["name"~"^(${names.join('|')})$"]${bbox};\nout geom;`;

export const REF_SPECS: RefSpec[] = [
  {
    id: 'interamericana',
    title: 'Interamericana chain (ref=1: Carretera Panamericana, Puente de las Américas, city avenues, east to Tocumen/Pacora)',
    bbox: B_CITY,
    query: linkQ('way["highway"~"^(motorway|trunk|primary)$"]["ref"="1"][bbox];', '(8.85,-79.75,9.15,-79.25)'),
    note: 'ref=1 ways of highway motorway|trunk|primary plus motorway/trunk/primary links that touch them (junction positions). Includes city avenues and both carriageways.',
  },
  {
    id: 'transistmica',
    title: 'Carretera Transístmica (ref=3, Panama City to the Caribbean side)',
    bbox: B_ISTHMUS,
    query: '[out:json][timeout:90];\nway["highway"~"^(trunk|primary)$"]["ref"="3"][bbox];\nout geom;',
    note: 'ref=3 primary/trunk ways (the OSM route is mostly highway=primary). The city end (Avenida Simón Bolívar and others) is included.',
  },
  {
    id: 'autopista-panama-colon',
    title: 'Autopista Panamá-Colón (ref=9 motorway, with interchange links)',
    bbox: B_ISTHMUS,
    query: linkQ('way["highway"="motorway"]["ref"="9"][bbox];', '(8.85,-80.05,9.45,-79.25)'),
    note: 'motorway ref=9 ways plus links touching them. OSM covers only part of the Colón end; see metrics.',
  },
  {
    id: 'corredor-sur',
    title: 'Corredor Sur (motorway along the bay to Tocumen, with interchange links)',
    bbox: B_CITY,
    query: linkQ('way["highway"="motorway"]["name"="Corredor Sur"][bbox];', '(8.85,-79.75,9.15,-79.25)'),
    note: 'name=Corredor Sur motorway ways plus links touching them.',
  },
  {
    id: 'cinta-costera',
    title: 'Cinta Costera 1-3 and Avenida Balboa viaduct (bay side of Casco Viejo)',
    bbox: [8.935, -79.56, 8.99, -79.5],
    query: '[out:json][timeout:90];\nway["highway"~"^(motorway|trunk|primary)$"]["name"~"^(Cinta Costera|Avenida Balboa Viaducto|Avenida Balboa)$"][bbox];\nout geom;',
    note: 'Cinta Costera trunk/motorway ways and Avenida Balboa(+Viaducto). The viaduct ways have bridge=yes in OSM but the tag is not kept here.',
  },
  {
    id: 'canal',
    title: 'Panama Canal (waterway=canal, Canal de Panamá)',
    bbox: B_ISTHMUS,
    query: '[out:json][timeout:90];\nway["waterway"="canal"]["name"="Canal de Panamá"][bbox];\nout geom;',
    note: 'Canal de Panamá centre-line ways (navigation channel), Pacific entrance to Limón Bay.',
  },
  {
    id: 'rivers-pacific',
    title: 'Main rivers, Pacific slope (named, in OSM)',
    bbox: [8.85, -79.9, 9.3, -79.25],
    query: riverQ(RIVER_NAMES.pacific, '(8.85,-79.9,9.3,-79.25)'),
    note: `Named river ways: ${RIVER_NAMES.pacific.join(', ')}. Mouth of each = southernmost end of its longest path.`,
    group: 'pacific',
  },
  {
    id: 'rivers-atlantic',
    title: 'Main rivers, Atlantic slope (named, in OSM)',
    bbox: [8.85, -80.1, 9.45, -79.25],
    query: riverQ(RIVER_NAMES.atlantic, '(8.85,-80.1,9.45,-79.25)'),
    note: `Named river ways: ${RIVER_NAMES.atlantic.join(', ')}.`,
    group: 'atlantic',
  },
  {
    id: 'tocumen-runways',
    title: 'Tocumen runways (aeroway=runway)',
    bbox: [9.03, -79.43, 9.12, -79.34],
    query: '[out:json][timeout:60];\nway["aeroway"="runway"][bbox];\nout geom;',
    note: 'aeroway=runway ways around Tocumen International Airport.',
  },
  {
    id: 'gatun-lake',
    title: 'Gatún Lake outline (relation natural=water name=Lago Gatún)',
    bbox: [8.85, -80.1, 9.45, -79.3],
    query: '[out:json][timeout:120];\nrelation["natural"="water"]["name"="Lago Gatún"][bbox];\nout geom;',
    note: 'Outer rings of the lake relation (simplified at 80 m to stay small). Islands (inner rings) are dropped.',
  },
];

/** Land cover zones: approximate real counterparts of the main game zones. Bboxes are rough, on purpose. */
export const COVER_ZONES: { id: string; district: string; bbox: Bbox; note: string }[] = [
  { id: 'city-core', district: 'city-core', bbox: [8.935, -79.57, 9.03, -79.49], note: 'Casco Viejo to Panamá Viejo, inland to Albrook/Calidonia' },
  { id: 'tito-corridor', district: 'tito-corridor', bbox: [9.03, -79.52, 9.14, -79.38], note: 'San Miguelito, Juan Díaz, Pedregal, Tocumen town' },
  { id: 'jungle-ridge', district: 'jungle-ridge', bbox: [9.14, -79.78, 9.28, -79.62], note: 'Soberanía / Camino de Cruces / Transístmica ridge' },
  { id: 'colon', district: 'colon', bbox: [9.33, -79.95, 9.4, -79.83], note: 'Colón city and Zona Libre, Manzanillo' },
];

export const COVER_CLASSES: Record<string, string[]> = {
  forest: ['natural=wood', 'landuse=forest'],
  wetland: ['natural=wetland', 'natural=mangrove'],
  urban: ['landuse=residential', 'landuse=commercial', 'landuse=retail', 'landuse=industrial'],
  farmland: ['landuse=farmland', 'landuse=meadow', 'landuse=orchard', 'landuse=farmyard', 'landuse=grass'],
  water: ['natural=water'],
};

export function coverQuery(bbox: Bbox): string {
  const b = `(${bbox.join(',')})`;
  const sel: string[] = [];
  for (const kv of Object.values(COVER_CLASSES).flat()) {
    const [k, v] = kv.split('=');
    sel.push(`way["${k}"="${v}"]${b};`, `relation["${k}"="${v}"]${b};`);
  }
  return `[out:json][timeout:120];\n(${sel.join('')});\nout geom;`;
}

// ---------------------------------------------------------------- land cover (polygon areas clipped to bbox)

/** Sutherland-Hodgman clip of a ring to a lon/lat box. */
export function clipRing(ring: [number, number][], bbox: Bbox): [number, number][] {
  const [s, w, n, e] = bbox;
  type Edge = (p: [number, number]) => boolean;
  const sides: { inside: Edge; cut: (a: [number, number], b: [number, number]) => [number, number] }[] = [
    { inside: (p) => p[0] >= w, cut: (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= e, cut: (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= s, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s] },
    { inside: (p) => p[1] <= n, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n] },
  ];
  let out = ring.slice(0, -1);
  for (const sd of sides) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i]!, prev = inp[(i + inp.length - 1) % inp.length]!;
      if (sd.inside(cur)) {
        if (!sd.inside(prev)) out.push(sd.cut(prev, cur));
        out.push(cur);
      } else if (sd.inside(prev)) out.push(sd.cut(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}

export function ringAreaM2(ring: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    s += a[0] * LON_M * (b[1] * LAT_M) - b[0] * LON_M * (a[1] * LAT_M);
  }
  return Math.abs(s) / 2;
}

export interface CoverZoneFile {
  id: string;
  district: string;
  bbox: Bbox;
  bbox_area_km2: number;
  /** Summed polygon area per class, clipped to the bbox, km2. OSM polygons can overlap, so the sum may exceed the bbox. */
  classes_km2: Record<string, number>;
  polygons: Record<string, number>;
  provenance: RefFile['provenance'];
}

export function bakeCover(zone: (typeof COVER_ZONES)[number], data: OverpassJson, date: string): CoverZoneFile {
  const classes_km2: Record<string, number> = {};
  const polygons: Record<string, number> = {};
  for (const c of Object.keys(COVER_CLASSES)) { classes_km2[c] = 0; polygons[c] = 0; }
  const classOf = (t: Record<string, string>): string | undefined => {
    for (const [c, kvs] of Object.entries(COVER_CLASSES)) for (const kv of kvs) { const [k, v] = kv.split('='); if (t[k!] === v) return c; }
    return undefined;
  };
  const elements = data.elements.slice().sort((a, b) => a.id - b.id);
  for (const e of elements) {
    const c = classOf(e.tags ?? {});
    if (!c) continue;
    let rings: [number, number][][] = [];
    if (e.type === 'way' && e.geometry) {
      const g = geom(e.geometry);
      if (g.length >= 4 && g[0]![0] === g[g.length - 1]![0] && g[0]![1] === g[g.length - 1]![1]) rings = [g];
    } else if (e.type === 'relation' && e.members) {
      rings = assembleRings(e.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => geom(m.geometry!)));
    }
    for (const r of rings) {
      const cl = clipRing(r, zone.bbox);
      if (cl.length < 3) continue;
      classes_km2[c] = classes_km2[c]! + ringAreaM2(cl) / 1e6;
      polygons[c] = polygons[c]! + 1;
    }
  }
  for (const c of Object.keys(classes_km2)) classes_km2[c] = Math.round(classes_km2[c]! * 1000) / 1000;
  const [s, w, n, e] = zone.bbox;
  return {
    id: zone.id,
    district: zone.district,
    bbox: zone.bbox,
    bbox_area_km2: Math.round(((n - s) * LAT_M * (e - w) * LON_M) / 1e4) / 100,
    classes_km2,
    polygons,
    provenance: {
      source: SOURCE,
      query: coverQuery(zone.bbox),
      date,
      licence: LICENCE,
      attribution: ATTRIBUTION,
      bbox: zone.bbox,
      simplify_m: 0,
      note: `Polygon areas by OSM tag class (${Object.entries(COVER_CLASSES).map(([k, v]) => `${k}: ${v.join('+')}`).join('; ')}), clipped to the bbox. Approximate real counterpart of game zone ${zone.district}: ${zone.note}. Only closed ways and assembled relation outer rings count; inner rings ignored.`,
    },
  };
}

export function serializeCover(c: CoverZoneFile): string {
  return JSON.stringify(sortKeys(c), null, 1) + '\n';
}

// ---------------------------------------------------------------- metrics (from UNWARPED refs)

interface Graph { keys: string[]; adj: Map<string, { to: string; len: number; ways: number[] }[]>; pos: Map<string, [number, number]> }
const pk = (p: [number, number]): string => `${p[0]},${p[1]}`;

const SNAP_M = 25;

/** Way ends within SNAP_M of an existing node share it (OSM junctions split by simplification or tiny gaps). */
function buildGraph(features: RefFeature[]): Graph {
  const adj = new Map<string, { to: string; len: number; ways: number[] }[]>();
  const pos = new Map<string, [number, number]>();
  const canon: [number, number][] = [];
  const snap = (p: [number, number]): string => {
    let best: [number, number] | undefined, bd = SNAP_M;
    for (const c of canon) { const d = chordM(c, p); if (d <= bd) { bd = d; best = c; } }
    if (!best) { canon.push(p); best = p; }
    pos.set(pk(best), best);
    return pk(best);
  };
  for (const f of [...features].sort((x, y) => x.id - y.id)) {
    const ka = snap(f.coords[0]!), kb = snap(f.coords[f.coords.length - 1]!);
    if (ka === kb) continue;
    const len = lengthM(f.coords);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push({ to: kb, len, ways: [f.id] });
    adj.get(kb)!.push({ to: ka, len, ways: [f.id] });
  }
  return { keys: [...adj.keys()].sort(), adj, pos };
}

function dijkstra(g: Graph, src: string): { dist: Map<string, number>; prev: Map<string, string> } {
  const dist = new Map<string, number>([[src, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (;;) {
    let u: string | undefined, du = Infinity;
    for (const k of g.keys) { const d = dist.get(k); if (d !== undefined && !done.has(k) && d < du) { du = d; u = k; } }
    if (u === undefined) break;
    done.add(u);
    for (const e of g.adj.get(u)!) {
      const nd = du + e.len;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); }
    }
  }
  return { dist, prev };
}

/** Way length (km) of each connected part of the way graph, largest first (the main path covers only the largest). */
export function connectedPartsKm(features: RefFeature[]): number[] {
  const g = buildGraph(features.filter((f) => f.role !== 'link'));
  const seen = new Set<string>();
  const parts: number[] = [];
  for (const start of g.keys) {
    if (seen.has(start)) continue;
    const { dist } = dijkstra(g, start);
    const keys = [...dist.keys()];
    keys.forEach((k) => seen.add(k));
    parts.push(Math.round(keys.reduce((a, k) => a + g.adj.get(k)!.reduce((t, e) => t + e.len, 0), 0) / 2 / 100) / 10);
  }
  return parts.sort((a, b) => b - a);
}

export interface MainPath { from: [number, number]; to: [number, number]; length_m: number; chord_m: number; tortuosity: number; keys: string[] }

/**
 * Main path of a feature set: in the component with the most way length, the pair of nodes with the largest straight
 * chord, joined by the shortest path along the ways. Handles dual carriageways and branches.
 */
export function mainPath(features: RefFeature[]): MainPath | null {
  const g = buildGraph(features.filter((f) => f.role !== 'link'));
  if (!g.keys.length) return null;
  // components, ranked by total edge length
  const comps: { keys: string[]; len: number }[] = [];
  const seen = new Set<string>();
  for (const start of g.keys) {
    if (seen.has(start)) continue;
    const { dist } = dijkstra(g, start);
    const keys = [...dist.keys()].sort();
    keys.forEach((k) => seen.add(k));
    const len = keys.reduce((s, k) => s + g.adj.get(k)!.reduce((t, e) => t + e.len, 0), 0) / 2;
    comps.push({ keys, len });
  }
  comps.sort((a, b) => b.len - a.len);
  const keys0 = comps[0]!.keys;
  let a = keys0[0]!, b = keys0[0]!, best = -1;
  for (let i = 0; i < keys0.length; i++)
    for (let j = i + 1; j < keys0.length; j++) {
      const c = chordM(g.pos.get(keys0[i]!)!, g.pos.get(keys0[j]!)!);
      if (c > best) { best = c; a = keys0[i]!; b = keys0[j]!; }
    }
  const { dist, prev } = dijkstra(g, a);
  const keys = [b];
  while (keys[0] !== a) keys.unshift(prev.get(keys[0]!)!);
  const from = g.pos.get(a)!, to = g.pos.get(b)!;
  const len = dist.get(b)!;
  return { from, to, length_m: len, chord_m: best, tortuosity: best > 0 ? len / best : 0, keys };
}

const r = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;

/** Polyline of the main path: the way used between consecutive path nodes (shortest parallel way). */
function pathPolyline(features: RefFeature[], p: MainPath): [number, number][] {
  const out: [number, number][] = [];
  const ways = features.filter((f) => f.role !== 'link');
  const near = (a: [number, number], k: string): boolean => { const [lo, la] = k.split(',').map(Number); return chordM(a, [lo!, la!]) <= SNAP_M; };
  for (let i = 1; i < p.keys.length; i++) {
    const a = p.keys[i - 1]!, b = p.keys[i]!;
    let bestW: RefFeature | undefined, bl = Infinity, fwd = true;
    for (const w of ways) {
      const c0 = w.coords[0]!, c1 = w.coords[w.coords.length - 1]!;
      const f = near(c0, a) && near(c1, b), rv = near(c0, b) && near(c1, a);
      if (f || rv) { const l = lengthM(w.coords); if (l < bl || (l === bl && w.id < bestW!.id)) { bl = l; bestW = w; fwd = f; } }
    }
    if (!bestW) continue;
    const c = fwd ? bestW.coords : bestW.coords.slice().reverse();
    out.push(...(out.length ? c.slice(1) : c));
  }
  return out;
}

/** Interchange positions: link endpoints touching the road, projected on the main path, clustered. */
function interchangeSpacing(features: RefFeature[], path: [number, number][]): { count: number; spacing_m: number[]; mean_spacing_m: number | null } {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + lengthM([path[i - 1]!, path[i]!]));
  const arc: number[] = [];
  for (const f of features.filter((x) => x.role === 'link')) {
    let bestD = Infinity, bestS = 0;
    for (const end of [f.coords[0]!, f.coords[f.coords.length - 1]!]) {
      path.forEach((p, i) => { const d = chordM(end, p); if (d < bestD) { bestD = d; bestS = cum[i]!; } });
    }
    if (bestD < 60) arc.push(bestS);
  }
  arc.sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const s of arc) {
    const last = clusters[clusters.length - 1];
    if (last && s - last[last.length - 1]! < 500) last.push(s); else clusters.push([s]);
  }
  const pos = clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  const spacing = pos.slice(1).map((p, i) => p - pos[i]!);
  return { count: pos.length, spacing_m: spacing.map((v) => Math.round(v)), mean_spacing_m: spacing.length ? Math.round(spacing.reduce((a, b) => a + b, 0) / spacing.length) : null };
}

const bearing = (a: [number, number], b: [number, number]): number => {
  const p = toMetres(a[0], a[1]), q = toMetres(b[0], b[1]);
  return (((Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI) % 360 + 360) % 360;
};

export interface Metrics {
  generated_from: string;
  attribution: string;
  note: string;
  roads: Record<string, unknown>;
  rivers: Record<string, unknown>;
  runways: unknown;
  land_cover: Record<string, unknown>;
}

export function computeMetrics(refs: Record<string, RefFile>, cover: Record<string, CoverZoneFile>): Metrics {
  const roads: Record<string, unknown> = {};
  for (const id of ['interamericana', 'transistmica', 'autopista-panama-colon', 'corredor-sur', 'cinta-costera', 'canal']) {
    const ref = refs[id];
    if (!ref) continue;
    const mp = mainPath(ref.features);
    const total = ref.features.filter((f) => f.role !== 'link').reduce((s, f) => s + lengthM(f.coords), 0);
    const entry: Record<string, unknown> = {
      source: `specs/map/refs/${id}.json`,
      method: 'Main path = shortest path between the two farthest-apart nodes of the largest connected part of the way graph (unwarped, simplified ways); tortuosity = path length / straight chord of its two ends. Total = summed way length (both carriageways).',
      bbox: ref.provenance.bbox,
      ways: ref.features.filter((f) => f.role !== 'link').length,
      total_way_length_km: r(total / 1000, 1),
      connected_parts_km: connectedPartsKm(ref.features).slice(0, 6),
    };
    if (mp) {
      entry.main_path = { length_km: r(mp.length_m / 1000, 2), chord_km: r(mp.chord_m / 1000, 2), tortuosity: r(mp.tortuosity), from: mp.from, to: mp.to };
      if (ref.features.some((f) => f.role === 'link')) {
        entry.interchanges = {
          method: 'Link ways (highway=*_link) whose end lies within 60 m of the main path, projected on it and clustered within 500 m; spacing along the path.',
          ...interchangeSpacing(ref.features, pathPolyline(ref.features, mp)),
        };
      }
    }
    roads[id] = entry;
  }

  const rivers: Record<string, unknown> = {};
  for (const id of ['rivers-pacific', 'rivers-atlantic']) {
    const ref = refs[id];
    if (!ref) continue;
    const names = [...new Set(ref.features.map((f) => f.name!))].sort();
    const per: Record<string, unknown> = {};
    const mouths: { name: string; lon: number; lat: number }[] = [];
    for (const n of names) {
      const mp = mainPath(ref.features.filter((f) => f.name === n));
      if (!mp) continue;
      const mouth = id === 'rivers-pacific' ? (mp.from[1] < mp.to[1] ? mp.from : mp.to) : (mp.from[1] > mp.to[1] ? mp.from : mp.to);
      mouths.push({ name: n, lon: mouth[0], lat: mouth[1] });
      per[n] = { length_km: r(mp.length_m / 1000, 2), tortuosity: r(mp.tortuosity), mouth };
    }
    const entry: Record<string, unknown> = {
      source: `specs/map/refs/${id}.json`,
      bbox: ref.provenance.bbox,
      method: 'Per name: main path over its ways (source to mouth), tortuosity = length / chord; mouth = the end of that path nearest the sea (southernmost for the Pacific slope, northernmost for the Atlantic). Tributaries sharing a mouth area are listed as separate rivers.',
      rivers: per,
    };
    if (id === 'rivers-pacific') {
      // Mouths on the Pacific shore: those that actually end at the coast (lat < 9.0 near the bay), ordered by longitude.
      const shore = mouths.filter((m) => m.lat < 9.05).sort((a, b) => a.lon - b.lon);
      const gaps = shore.slice(1).map((m, i) => ({ between: [shore[i]!.name, m.name], gap_m: Math.round(chordM([shore[i]!.lon, shore[i]!.lat], [m.lon, m.lat])) }));
      entry.pacific_shore_mouths = {
        method: 'Mouths with lat < 9.05 (Panama Bay shore), sorted by longitude; gap = straight distance between neighbouring mouths in the real metric frame.',
        order: shore.map((m) => m.name),
        gaps,
        mean_gap_m: gaps.length ? Math.round(gaps.reduce((s, g) => s + g.gap_m, 0) / gaps.length) : null,
      };
    }
    rivers[id] = entry;
  }

  let runways: unknown = null;
  const rw = refs['tocumen-runways'];
  if (rw) {
    runways = {
      source: 'specs/map/refs/tocumen-runways.json',
      bbox: rw.provenance.bbox,
      method: 'Per way: summed segment length of the simplified polyline, bearing of its first-to-last chord (deg from north, 0-360 as stored). Ways of one runway can be split; see total.',
      ways: rw.features.map((f) => ({ id: f.id, name: f.name ?? null, length_m: Math.round(lengthM(f.coords)), bearing_deg: r(bearing(f.coords[0]!, f.coords[f.coords.length - 1]!), 1) })),
      total_length_m: Math.round(rw.features.reduce((s, f) => s + lengthM(f.coords), 0)),
    };
  }

  const land_cover: Record<string, unknown> = {};
  for (const id of Object.keys(cover).sort()) {
    const c = cover[id]!;
    const shares: Record<string, number> = {};
    for (const [k, v] of Object.entries(c.classes_km2)) shares[k] = r(v / c.bbox_area_km2, 3);
    land_cover[id] = {
      source: `specs/map/refs/landcover-${id}.json`,
      method: 'Share = summed OSM polygon area of the class clipped to the bbox / bbox area. Overlapping polygons and sea inside the bbox are not removed; OSM tagging is incomplete, so shares are lower bounds of the real cover.',
      bbox: c.bbox,
      approximate_bbox: true,
      game_district: c.district,
      bbox_area_km2: c.bbox_area_km2,
      shares_of_bbox: shares,
    };
  }

  return {
    generated_from: 'specs/map/refs/*.json (unwarped); recomputed by `node tools/bake-refs.mjs --metrics-only`',
    attribution: ATTRIBUTION,
    note: 'Frozen reference numbers (F06). Do not edit by hand. Sources are OpenStreetMap contributors (ODbL).',
    roads,
    rivers,
    runways,
    land_cover,
  };
}

// ---------------------------------------------------------------- warped drafts + overlay

export interface WarpedRef { id: string; title: string; warped_draft: true; warning: string; provenance: { source: string; attribution: string; licence: string; date: string; note: string }; outside_land: { total: number; outside: number; fraction: number; max_distance_m: number }; features: { id: number; name?: string; kind: string; xy: [number, number][] }[] }

export function warpRef(ref: RefFile, warp: Warp, land: Vec2[]): WarpedRef {
  const features = ref.features.map((f) => {
    const o: { id: number; name?: string; kind: string; xy: [number, number][] } = { id: f.id, kind: f.kind, xy: f.coords.map(([lon, lat]) => { const [x, y] = warp.apply(lon, lat); return [Math.round(x), Math.round(y)] as [number, number]; }) };
    if (f.name) o.name = f.name;
    return o;
  });
  const out = outsideLand(features.flatMap((f) => f.xy), land);
  return {
    id: ref.id,
    title: ref.title,
    warped_draft: true,
    warning: 'WARPED DRAFT in the map frame through specs/map/anchors.yaml (piecewise-affine). A ruler for overlays and first drafts, not geometry: take metrics from the unwarped ref.',
    provenance: { source: ref.provenance.source, attribution: ATTRIBUTION, licence: ref.provenance.licence, date: ref.provenance.date, note: 'Derived from specs/map/refs/' + ref.id + '.json' },
    outside_land: { total: out.total, outside: out.outside, fraction: Math.round(out.fraction * 1000) / 1000, max_distance_m: Math.round(out.maxDistance) },
    features,
  };
}

export function serializeWarped(w: WarpedRef): string {
  const { features, ...rest } = w;
  const head = JSON.stringify(sortKeys(rest));
  return `${head.slice(0, -1)},"features":[\n${features.map((f) => JSON.stringify(sortKeys(f))).join(',\n')}\n]}\n`;
}

export interface OverlayInput {
  land: Vec2[];
  routes: Record<string, Vec2[]>;
  anchors: { id: string; map: Vec2 }[];
  warped: WarpedRef[];
}

const STYLE: Record<string, string> = {
  interamericana: '#d9822b', transistmica: '#b5562a', 'autopista-panama-colon': '#a33', 'corredor-sur': '#c0398a', 'cinta-costera': '#2a9d8f',
  canal: '#1a5fb4', 'rivers-pacific': '#3b9ae1', 'rivers-atlantic': '#3b9ae1', 'tocumen-runways': '#222', 'gatun-lake': '#8ecae6',
};

/** SVG, y flipped so north is up. Deterministic string. */
export function overlaySvg(o: OverlayInput): string {
  const W = 6000, H = 8000;
  const pts = (p: Vec2[]): string => p.map(([x, y]) => `${x},${H - y}`).join(' ');
  const L: string[] = [];
  L.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="750" height="1000">`);
  L.push('<!-- WARPED DRAFTS of OpenStreetMap references through specs/map/anchors.yaml. Not game geometry. © OpenStreetMap contributors (ODbL). Generated by tools/bake-refs.mjs. -->');
  L.push(`<rect width="${W}" height="${H}" fill="#cfe8f3"/>`);
  L.push(`<polygon points="${pts(o.land)}" fill="#e6ecd3" stroke="#555" stroke-width="6"/>`);
  for (const w of o.warped) {
    const col = STYLE[w.id] ?? '#000';
    const fill = w.id === 'gatun-lake';
    for (const f of w.features) L.push(`<polyline points="${pts(f.xy)}" fill="${fill ? col : 'none'}" fill-opacity="0.5" stroke="${col}" stroke-width="${fill ? 4 : 7}" stroke-dasharray="${fill ? '' : '24 10'}"/>`);
  }
  for (const id of Object.keys(o.routes).sort()) L.push(`<polyline points="${pts(o.routes[id]!)}" fill="none" stroke="#111" stroke-width="10"/><title>${id}</title>`);
  for (const a of o.anchors) L.push(`<circle cx="${a.map[0]}" cy="${H - a.map[1]}" r="45" fill="#e63946"/><text x="${a.map[0] + 60}" y="${H - a.map[1] + 14}" font-size="70" font-family="sans-serif">${a.id}</text>`);
  L.push('<text x="40" y="7940" font-size="60" font-family="sans-serif">Dashed = warped OSM drafts (colour per ref), solid black = current world.yaml routes, red = anchors. © OpenStreetMap contributors</text>');
  L.push('</svg>');
  return L.join('\n') + '\n';
}
