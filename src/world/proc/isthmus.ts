/**
 * The procedural isthmus pipeline. Each stage reads only earlier stages:
 *
 *   coast (authored) → relief (uplift + erosion + hummocks) → reservoir (flood behind the dam)
 *   → rivers (drainage area) + canal (cheapest excavation) → airport (flattest site)
 *   → main roads (slope cost) → towns (suitability + growth along roads) → land cover
 *
 * Authored inputs are coarse intent only (uplift zones, dam / lock / airport hints, town seeds and
 * target areas, route stops); every shape on the map is computed. Pure and deterministic.
 */
import type { WorldSpec } from '../spec.ts';
import type { Vec2 } from '../vec.ts';
import { levelAirport, siteAirport, type AirportResult } from './airport.ts';
import { classifyCover } from './cover.ts';
import { cellAt, makeShape, mask, type FieldGrid, type MaskGrid } from './grid.ts';
import { slopeField } from './hydrology.ts';
import { floodReservoir, type LakeResult } from './lake.ts';
import { AIRPORT, AIRPORT_TERMINAL, CANAL, COVER, DEFAULT_CELL, GROWTH, LAKE, RELIEF, RIVERS, ROAD_STOPS, ROADS, SUITABILITY, TOWNS, TRANSIT } from './params.ts';
import { generateRelief, type ReliefResult } from './relief.ts';
import type { Dot, RenderInput, Stroke } from './render.ts';
import { nearRoads, routeRoads, type RoadsResult } from './roads.ts';
import { growTowns, suitability, type GrowthResult } from './settlements.ts';
import { routeTransit, type TransitResult } from './transit.ts';
import { extractRivers, routeCanal, type CanalResult, type RiverSegment } from './water.ts';

export interface Isthmus {
  readonly relief: ReliefResult;
  /** Final height after canal carving and airport levelling. */
  readonly height: FieldGrid;
  readonly lake: LakeResult;
  readonly rivers: readonly RiverSegment[];
  readonly canal: CanalResult;
  readonly airport: AirportResult;
  readonly roads: RoadsResult;
  readonly towns: GrowthResult;
  readonly cover: Uint8Array;
  readonly transit: TransitResult;
  readonly report: readonly string[];
}

function strokeMask(shapeOf: MaskGrid, lines: readonly { points: readonly Vec2[]; width: number }[]): MaskGrid {
  const out = mask(shapeOf);
  for (const l of lines) {
    const r = Math.max(shapeOf.cell * 0.5, l.width / 2);
    for (let k = 1; k < l.points.length; k++) {
      const a = l.points[k - 1]!;
      const b = l.points[k]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(len / (shapeOf.cell * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const x = a.x + ((b.x - a.x) * s) / steps;
        const y = a.y + ((b.y - a.y) * s) / steps;
        const rc = Math.ceil(r / shapeOf.cell);
        const c = cellAt(shapeOf, x, y);
        const cx = c % shapeOf.w;
        const cy = (c - cx) / shapeOf.w;
        for (let dy = -rc; dy <= rc; dy++)
          for (let dx = -rc; dx <= rc; dx++) {
            const gx = cx + dx;
            const gy = cy + dy;
            if (gx < 0 || gy < 0 || gx >= shapeOf.w || gy >= shapeOf.h) continue;
            if (Math.hypot(((gx + 0.5) * shapeOf.cell) - x, ((gy + 0.5) * shapeOf.cell) - y) <= r) out.data[gy * shapeOf.w + gx] = 1;
          }
      }
    }
  }
  return out;
}

function insideRing(q: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Drops the parts of river segments that run inside `ring` (culverted under an airfield). */
function clipOutside(rivers: readonly RiverSegment[], ring: readonly Vec2[]): RiverSegment[] {
  const out: RiverSegment[] = [];
  for (const r of rivers) {
    let cur: Vec2[] = [];
    for (const q of r.points) {
      if (insideRing(q, ring)) {
        if (cur.length > 1) out.push({ ...r, points: cur });
        cur = [];
      } else cur.push(q);
    }
    if (cur.length > 1) out.push({ ...r, points: cur });
  }
  return out;
}

export function generateIsthmus(spec: WorldSpec, opts: { cell?: number } = {}): Isthmus {
  const cell = opts.cell ?? DEFAULT_CELL;
  const shape = makeShape(spec.bounds.width, spec.bounds.height, cell);
  const report: string[] = [];
  const relief = generateRelief(shape, { land: spec.land, islands: spec.islands.map((i) => i.points) }, RELIEF);
  let landN = 0;
  let maxH = 0;
  for (let i = 0; i < relief.land.data.length; i++) {
    if (relief.land.data[i]) {
      landN++;
      maxH = Math.max(maxH, relief.height.data[i]!);
    }
  }
  report.push(`land ${((landN * cell * cell) / 1e6).toFixed(2)} km², max height ${maxH.toFixed(0)} m`);

  const lake = floodReservoir(relief.height, relief.land, relief.distToSea, relief.routing, relief.area, LAKE);
  report.push(`lake ${lake.areaKm2.toFixed(2)} km² at ${lake.level.toFixed(1)} m; dam (${lake.dam.x.toFixed(0)}, ${lake.dam.y.toFixed(0)}), catchment ${lake.catchmentKm2.toFixed(2)} km²`);

  const allRivers = extractRivers(shape, relief.land, lake.lake, relief.routing, relief.area, RIVERS);
  const canal = routeCanal(relief.height, lake.lake, lake.level, lake.dam, CANAL);
  report.push(`rivers ${allRivers.length} segments; canal ${canal.centreline.length} pts`);

  // Final height: copy, carve the canal, level the airfield.
  const height: FieldGrid = { ...relief.height, data: Float64Array.from(relief.height.data) };
  const water = mask(shape);
  for (let i = 0; i < water.data.length; i++) water.data[i] = lake.lake.data[i] || canal.channel.data[i] ? 1 : 0;
  // Only large rivers rule out an airfield; small streams inside it are culverted (dropped below).
  const riverWide = strokeMask(relief.land, allRivers.filter((r) => r.areaKm2 >= 1.2).map((r) => ({ points: r.points, width: r.width + 60 })));
  const airport = siteAirport(height, relief.land, water, riverWide, AIRPORT);
  const rivers = clipOutside(allRivers, airport.field);
  const riverMask = strokeMask(relief.land, rivers.map((r) => ({ points: r.points, width: r.width })));
  levelAirport(height, airport, 150);
  for (let i = 0; i < height.data.length; i++) if (canal.channel.data[i] && !lake.lake.data[i]) height.data[i] = Math.min(height.data[i]!, lake.level - CANAL.depth);
  report.push(`airport at (${airport.centre.x.toFixed(0)}, ${airport.centre.y.toFixed(0)}), heading ${((Math.atan2(airport.dir.x, airport.dir.y) * 180) / Math.PI).toFixed(0)}°, spread ${airport.spread.toFixed(1)} m`);

  const wet = mask(shape);
  for (let i = 0; i < wet.data.length; i++) wet.data[i] = canal.channel.data[i] || riverMask.data[i] ? 1 : 0;
  for (let i = 0; i < wet.data.length; i++) if (canal.channel.data[i]) wet.data[i] = 2;
  // Roads and tracks may not cross the reservoir or the airfield.
  const blocked = mask(shape);
  for (let gy = 0; gy < shape.h; gy++)
    for (let gx = 0; gx < shape.w; gx++) {
      const i = gy * shape.w + gx;
      const x = (gx + 0.5) * cell;
      const y = (gy + 0.5) * cell;
      blocked.data[i] = lake.lake.data[i] || insideRing({ x, y }, airport.field) ? 1 : 0;
    }
  const S = ROAD_STOPS;
  const terminal = airport.terminal;
  const roads = routeRoads(height, relief.land, blocked, wet, {
    ...ROADS,
    routes: [
      { id: 'interamericana', kind: 'highway', stops: [S.balboa, S.city, terminal] },
      { id: 'transistmica', kind: 'highway', stops: [S.cityNorth, S.colon] },
      { id: 'gamboa-road', kind: 'road', stops: [S.city, S.gamboa] },
      { id: 'coastal-avenue', kind: 'road', stops: [S.oldQuarter, S.city, S.pacifica] },
      { id: 'railroad', kind: 'rail', stops: [S.balboa, S.gamboa, S.colon] },
    ],
  });
  report.push(`roads: ${roads.paths.map((r) => `${r.id} ${r.cells.length}`).join(', ')}`);

  const slope = slopeField(height);
  const unbuildable = mask(shape);
  for (let i = 0; i < unbuildable.data.length; i++) unbuildable.data[i] = water.data[i] ? 1 : 0;
  // The airfield is not for houses.
  for (let gy = 0; gy < shape.h; gy++)
    for (let gx = 0; gx < shape.w; gx++) {
      const x = (gx + 0.5) * cell - airport.centre.x;
      const y = (gy + 0.5) * cell - airport.centre.y;
      if (insideRing({ x: x + airport.centre.x, y: y + airport.centre.y }, airport.field)) unbuildable.data[gy * shape.w + gx] = 1;
    }
  const suit = suitability(height, slope, relief.land, unbuildable, riverMask, relief.distToSea, SUITABILITY);
  const highways = mask(shape);
  for (const r of roads.paths) if (r.kind !== 'rail') for (const c of r.cells) highways.data[c] = 1;
  // El Corredor: seeded along the Interamericana between the city stop and the airport terminal.
  const ia = roads.paths.find((r) => r.id === 'interamericana')!;
  // Nearest path cell to the city stop (stops are snapped to dry land, so match by distance).
  let startK = 0;
  let bestD = Number.POSITIVE_INFINITY;
  ia.cells.forEach((c, k) => {
    const d = Math.hypot(((c % shape.w) + 0.5) * cell - S.city.x, (Math.floor(c / shape.w) + 0.5) * cell - S.city.y);
    if (d < bestD) {
      bestD = d;
      startK = k;
    }
  });
  // Seeds and the road discount start past the middle of the city → airport stretch, so the ribbon
  // grows out towards the airport instead of filling the city's own plain.
  const corridorFrom = Math.floor(startK + (ia.cells.length - 1 - startK) * 0.45);
  const corridorSeeds = [0.55, 0.75, 0.92].map((f) => {
    const c = ia.cells[Math.floor(startK + (ia.cells.length - 1 - startK) * f)]!;
    return { x: ((c % shape.w) + 0.5) * cell, y: (Math.floor(c / shape.w) + 0.5) * cell };
  });
  const townSpecs = TOWNS.map((t) => (t.id === 'el-corredor' ? { ...t, seeds: corridorSeeds } : t));
  const allRoads = nearRoads(highways, 90);
  const corridorRoad = mask(shape);
  for (const c of ia.cells.slice(corridorFrom)) corridorRoad.data[c] = 1;
  const corridorNear = nearRoads(corridorRoad, 90);
  const towns = growTowns(suit, townSpecs.map((t) => (t.id === 'el-corredor' ? corridorNear : allRoads)), { ...GROWTH, towns: townSpecs }, riverMask);
  report.push(`towns: ${TOWNS.map((t, k) => `${t.id} ${towns.areasKm2[k]!.toFixed(2)}/${t.targetKm2}`).join(', ')} km²`);

  const cover = classifyCover(height, slope, relief.land, relief.distToSea, relief.area, towns.density, [airport.field], COVER);

  const transit = routeTransit(height, relief.land, blocked, wet, towns.density, highways, {
    ...TRANSIT,
    lines: TRANSIT.lines.map((l) => ({ ...l, branches: l.branches.map((b) => b.map((s) => (s === AIRPORT_TERMINAL ? terminal : s))) })),
  });
  report.push(`transit: ${transit.lines.map((l) => l.id).join(', ')}; ${transit.stations.length} stations, ${transit.stations.filter((s) => s.interchange).length} interchanges`);
  return { relief, height, lake, rivers, canal, airport, roads, towns, cover, transit, report };
}

const RIVER_BLUE: [number, number, number] = [52, 112, 166];
const CANAL_BLUE: [number, number, number] = [46, 108, 156];
const ROAD_TAN: [number, number, number] = [214, 192, 140];
const ROAD_CASE: [number, number, number] = [120, 104, 76];
const RAIL: [number, number, number] = [70, 62, 56];

export function isthmusRenderInput(iso: Isthmus): RenderInput {
  const strokes: Stroke[] = [];
  for (const r of iso.rivers) strokes.push({ points: r.points, width: r.width, color: RIVER_BLUE });
  // Split the canal centreline into runs over land (dug channel), over the lake (navigation channel)
  // and over the sea (not drawn).
  const runs: { kind: 'land' | 'lake' | 'sea'; pts: Vec2[] }[] = [];
  for (const q of iso.canal.centreline) {
    const i = cellAt(iso.height, q.x, q.y);
    const kind = !iso.relief.land.data[i] ? 'sea' : iso.lake.lake.data[i] ? 'lake' : 'land';
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.pts.push(q);
    else runs.push({ kind, pts: last ? [last.pts[last.pts.length - 1]!, q] : [q] });
  }
  for (const r of runs) {
    if (r.kind === 'land') strokes.push({ points: r.pts, width: 90, color: CANAL_BLUE });
    else if (r.kind === 'lake') strokes.push({ points: r.pts, width: 55, color: [70, 138, 176] });
  }
  for (const r of iso.roads.paths) {
    if (r.kind === 'rail') strokes.push({ points: r.points, width: 6, color: RAIL, casing: 4, casingColor: [150, 140, 120] });
    else strokes.push({ points: r.points, width: r.kind === 'highway' ? 16 : 10, color: ROAD_TAN, casing: 4, casingColor: ROAD_CASE });
  }
  for (const l of iso.transit.lines) {
    for (const t of l.tracks) {
      if (l.mode === 'rail') {
        strokes.push({ points: t, width: 11, color: l.color, casing: 3, casingColor: [250, 250, 250] });
        strokes.push({ points: t, width: 3, color: [250, 250, 250], dash: [14, 10] });
      } else strokes.push({ points: t, width: 13, color: l.color, casing: 3, casingColor: [250, 250, 250] });
    }
  }
  const tw = iso.airport.taxiway;
  strokes.push({ points: [tw.a, tw.b], width: tw.width, color: [150, 150, 146] });
  for (const rw of iso.airport.runways) {
    strokes.push({ points: [rw.a, rw.b], width: rw.width, color: [84, 84, 88], casing: 5, casingColor: [214, 214, 208] });
    strokes.push({ points: [rw.a, rw.b], width: 2.5, color: [235, 235, 230], dash: [30, 25] });
  }
  // Airfield: mown grass with the apron and terminal on the city side (runways are strokes).
  const fills: { ring: readonly Vec2[]; color: readonly [number, number, number] }[] = [
    { ring: iso.airport.field, color: [132, 156, 98] },
    { ring: iso.airport.apronRing, color: [176, 176, 172] },
    { ring: iso.airport.buildingRing, color: [222, 224, 226] },
  ];
  fills.push(...iso.canal.locks.flatMap((l) => {
    const n = { x: -l.dir.y, y: l.dir.x };
    const len = 320 * l.steps;
    const ring = (off: number) => [
      { x: l.at.x - l.dir.x * len * 0.5 + n.x * (off - 22), y: l.at.y - l.dir.y * len * 0.5 + n.y * (off - 22) },
      { x: l.at.x + l.dir.x * len * 0.5 + n.x * (off - 22), y: l.at.y + l.dir.y * len * 0.5 + n.y * (off - 22) },
      { x: l.at.x + l.dir.x * len * 0.5 + n.x * (off + 22), y: l.at.y + l.dir.y * len * 0.5 + n.y * (off + 22) },
      { x: l.at.x - l.dir.x * len * 0.5 + n.x * (off + 22), y: l.at.y - l.dir.y * len * 0.5 + n.y * (off + 22) },
    ];
    return [
      { ring: ring(0), color: [196, 196, 192] as [number, number, number] },
      { ring: ring(-30), color: [180, 180, 176] as [number, number, number] },
    ];
  }));
  const lineColor = new Map(iso.transit.lines.map((l) => [l.id, l.color] as const));
  const dots: Dot[] = iso.transit.stations.map((st) =>
    st.interchange
      ? { at: st.at, radius: 30, fill: [250, 250, 250], ring: [30, 30, 30], ringWidth: 7, core: { radius: 13, color: [30, 30, 30] } }
      : { at: st.at, radius: st.terminal ? 26 : 19, fill: [250, 250, 250], ring: lineColor.get(st.lines[0]!) ?? [0, 0, 0], ringWidth: st.terminal ? 9 : 7 },
  );
  return {
    dots,
    height: iso.height,
    land: iso.relief.land,
    shore: iso.relief.shore,
    lake: iso.lake.lake,
    lakeLevel: iso.lake.level,
    cover: iso.cover,
    urban: iso.towns.density,
    strokes,
    fills,
  };
}
