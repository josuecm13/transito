/** Metrics, hashes and invariant checks over a generated isthmus. Pure; no terrain logic lives here. */
import type { Isthmus } from '../world/proc/isthmus.ts';
import { COVER_FOREST, COVER_HIGH_FOREST, COVER_MANGROVE } from '../world/proc/render.ts';
import type { ProceduralSpec } from '../world/spec.ts';
import type { Vec2 } from '../world/vec.ts';
import { Hasher } from './hash.ts';

export interface Metrics {
  /** Built area per town (km²) and in total. */
  urbanKm2: number;
  townsKm2: Record<string, number>;
  lakeKm2: number;
  lakeLevelM: number;
  riverCount: number;
  riverKm: number;
  /** Highest land cell, metres. */
  maxReliefM: number;
  /** Closest built cell to the airfield, metres (the airport buffer in practice). */
  airportToTownM: number;
  /** Closest dense core cell (density ≥ 0.5) to the airfield, metres. */
  airportToDenseCoreM: number;
  /** Share of land that is forest / high forest / mangrove (protected wilderness). */
  wildernessShare: number;
  /** Routes with a connected path / total; metro and rail branches with a track / total. */
  roadsConnected: string;
  transitConnected: string;
  stations: number;
  airport: { x: number; y: number; headingDeg: number };
  /** District model (#13): area per district footprint (km², D ≥ footprint) and of the dense core (D ≥ 0.5); empty when off. */
  districtsKm2: Record<string, number>;
  districtDenseKm2: number;
  /** Closest dense district cell (D ≥ 0.5) to the airfield, metres (Infinity-safe: null when none). */
  airportToDistrictCoreM: number | null;
  /** Distance between each hint of the config and what the generator did with it (protected anchor deviation). */
  anchorDeviationM: Record<string, number>;
}

export interface Hashes {
  height: string;
  lake: string;
  rivers: string;
  roads: string;
  towns: string;
  transit: string;
  districts: string;
  all: string;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function ringDist(p: Vec2, ring: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, segDist(p, ring[i]!, ring[(i + 1) % ring.length]!));
  return d;
}

export function metricsOf(iso: Isthmus, P: ProceduralSpec): Metrics {
  const { w, cell } = iso.height;
  const land = iso.relief.land.data;
  let maxH = 0;
  let landN = 0;
  let wild = 0;
  for (let i = 0; i < land.length; i++) {
    if (!land[i]) continue;
    landN++;
    maxH = Math.max(maxH, iso.height.data[i]!);
    const c = iso.cover[i]!;
    if (c === COVER_FOREST || c === COVER_HIGH_FOREST || c === COVER_MANGROVE) wild++;
  }
  let toTown = Infinity;
  let toCore = Infinity;
  const field = iso.airport.field;
  for (let i = 0; i < iso.towns.owner.length; i++) {
    if (!iso.towns.owner[i]) continue;
    const p = { x: ((i % w) + 0.5) * cell, y: (Math.floor(i / w) + 0.5) * cell };
    const d = ringDist(p, field);
    toTown = Math.min(toTown, d);
    if (iso.towns.density.data[i]! >= 0.5) toCore = Math.min(toCore, d);
  }
  let toDistrict = Infinity;
  for (let i = 0; i < iso.districts.density.data.length; i++) {
    if (iso.districts.density.data[i]! < 0.5) continue;
    toDistrict = Math.min(toDistrict, ringDist({ x: ((i % w) + 0.5) * cell, y: (Math.floor(i / w) + 0.5) * cell }, field));
  }
  const townsKm2: Record<string, number> = {};
  P.towns.items.forEach((t, k) => (townsKm2[t.id] = round(iso.towns.areasKm2[k] ?? 0)));
  const roadsOk = iso.roads.paths.filter((p) => p.points.length > 1).length;
  const branches = iso.transit.lines.flatMap((l) => l.tracks);
  const expected = P.transit.lines.reduce((n, l) => n + l.branches.length, 0);
  const riverLen = iso.rivers.reduce((n, r) => n + r.points.reduce((s, q, k) => s + (k ? dist(q, r.points[k - 1]!) : 0), 0), 0);
  const dev: Record<string, number> = {
    'lake.dam_hint': dist(iso.lake.dam, P.lake.damHint),
    'airport.hint': dist(iso.airport.centre, P.airport.hint),
  };
  return {
    urbanKm2: round(iso.towns.areasKm2.reduce((a, b) => a + b, 0)),
    townsKm2,
    lakeKm2: round(iso.lake.areaKm2),
    lakeLevelM: round(iso.lake.level),
    riverCount: iso.rivers.length,
    riverKm: round(riverLen / 1000),
    maxReliefM: round(maxH),
    airportToTownM: round(toTown),
    airportToDenseCoreM: round(toCore),
    wildernessShare: round(landN ? wild / landN : 0, 3),
    roadsConnected: `${roadsOk}/${P.roads.routes.length}`,
    transitConnected: `${branches.filter((t) => t.length > 1).length}/${expected}`,
    stations: iso.transit.stations.length,
    airport: { x: round(iso.airport.centre.x, 0), y: round(iso.airport.centre.y, 0), headingDeg: round((Math.atan2(iso.airport.dir.x, iso.airport.dir.y) * 180) / Math.PI, 0) },
    districtsKm2: Object.fromEntries(iso.districts.ids.map((id, k) => [id, round(iso.districts.areasKm2[k] ?? 0)])),
    districtDenseKm2: round(iso.districts.denseKm2),
    airportToDistrictCoreM: Number.isFinite(toDistrict) ? round(toDistrict) : null,
    anchorDeviationM: Object.fromEntries(Object.entries(dev).map(([k, v]) => [k, round(v, 0)])),
  };
}

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

const pts = (h: Hasher, p: readonly Vec2[]): Hasher => {
  for (const q of p) h.int(Math.round(q.x * 10)).int(Math.round(q.y * 10));
  return h.int(p.length);
};

/** Deterministic fingerprints of each stage; the same config and cell always give the same ones. */
export function hashesOf(iso: Isthmus): Hashes {
  const rivers = new Hasher();
  for (const r of iso.rivers) pts(rivers, r.points).int(Math.round(r.width * 10));
  const roads = new Hasher();
  for (const r of iso.roads.paths) roads.str(r.id), pts(roads, r.points);
  const transit = new Hasher();
  for (const l of iso.transit.lines) {
    transit.str(l.id);
    for (const t of l.tracks) pts(transit, t);
  }
  for (const s of iso.transit.stations) pts(transit, [s.at]);
  const townsH = new Hasher().floats(iso.towns.density.data);
  for (const o of iso.towns.owner) townsH.int(o);
  const height = new Hasher().floats(iso.height.data).hex();
  const lake = new Hasher().floats([iso.lake.level, iso.lake.areaKm2, iso.lake.dam.x, iso.lake.dam.y]);
  for (const v of iso.lake.lake.data) lake.int(v);
  const districtsH = new Hasher().floats(iso.districts.density.data);
  for (const o of iso.districts.dominant) districtsH.int(o);
  const parts = { height, lake: lake.hex(), rivers: rivers.hex(), roads: roads.hex(), towns: townsH.hex(), transit: transit.hex() };
  const districts = districtsH.hex();
  const all = new Hasher();
  for (const v of Object.values(parts)) all.str(v);
  // The district field joins `all` only when districts exist, so a map without them keeps its fingerprint.
  if (iso.districts.ids.length) all.str(districts);
  return { ...parts, districts, all: all.hex() };
}
