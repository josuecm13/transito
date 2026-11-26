/**
 * The WorldSpec the game's street / city / slice pipeline runs on, derived from the procedural map
 * (#12 2.5; `procedural.game:`). Pure.
 *
 * The authored spec places things by coordinates on a 1 km district grid. On the procedural map the
 * game instead uses:
 *   active_area  the Act 1 strip and barrio (bounding box + rect_margin), same spawn landmark id
 *   grid         a district_cell grid from the generated map: per cell, the majority of sea, lake,
 *                each town, the airfield, else wild; named through procedural.game.districts
 *   routes       the generated roads and railway, the runways, and the canal centreline
 *   landmarks    the procedurally placed ones at their generated position; authored landmarks that
 *                fall inside the new active area but have no rule are dropped (`dropped`)
 *   districts    an authored `label_at` outside its own district on the derived grid is dropped, so
 *                the map labels the district at its derived cells (districtLabelPoint's fallback)
 * Everything else (profiles, styles, blockout, scale, population, coastline) is the authored spec.
 */
import type { Vec2 } from '../vec.ts';
import type { Landmark, Route, WorldSpec } from '../spec.ts';
import type { Rect } from '../geometry.ts';
import type { Isthmus } from './isthmus.ts';

export interface GameSpec {
  readonly spec: WorldSpec;
  /** Authored landmarks inside the new active area with no procedural rule (left out). */
  readonly dropped: readonly string[];
}

function insideRing(q: Vec2, ring: readonly Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Bounding box of the act1 strip (± half-width) and barrio, plus `margin`, clamped to the map. */
export function act1Rect(iso: Pick<Isthmus, 'act1'>, margin: number, bounds: { width: number; height: number }): Rect {
  const { strip, barrio } = iso.act1;
  let minX = barrio.centre.x - barrio.radius;
  let maxX = barrio.centre.x + barrio.radius;
  let minY = barrio.centre.y - barrio.radius;
  let maxY = barrio.centre.y + barrio.radius;
  for (const q of strip.centreline) {
    minX = Math.min(minX, q.x - strip.halfWidth);
    maxX = Math.max(maxX, q.x + strip.halfWidth);
    minY = Math.min(minY, q.y - strip.halfWidth);
    maxY = Math.max(maxY, q.y + strip.halfWidth);
  }
  return {
    minX: Math.max(0, Math.floor(minX - margin)),
    maxX: Math.min(bounds.width, Math.ceil(maxX + margin)),
    minY: Math.max(0, Math.floor(minY - margin)),
    maxY: Math.min(bounds.height, Math.ceil(maxY + margin)),
  };
}

/** District grid (rows north → south, like world.yaml's grid) from the generated map. */
export function districtGrid(spec: WorldSpec, iso: Isthmus): string[][] {
  const G = spec.procedural.game;
  const code = (src: string): string => spec.districts.find((d) => d.id === G.districts[src])!.code;
  const towns = spec.procedural.towns.items;
  const g = iso.towns.density;
  const cols = spec.bounds.width / G.districtCell;
  const rows = spec.bounds.height / G.districtCell;
  const per = Math.max(1, Math.round(G.districtCell / g.cell));
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    const cy0 = (rows - 1 - r) * G.districtCell;
    for (let c = 0; c < cols; c++) {
      const cx0 = c * G.districtCell;
      const votes = new Map<string, number>();
      for (let j = 0; j < per; j++) {
        for (let i = 0; i < per; i++) {
          const x = cx0 + ((i + 0.5) * G.districtCell) / per;
          const y = cy0 + ((j + 0.5) * G.districtCell) / per;
          const k = Math.min(g.h - 1, Math.floor(y / g.cell)) * g.w + Math.min(g.w - 1, Math.floor(x / g.cell));
          let src: string;
          if (!iso.relief.land.data[k]) src = 'sea';
          else if (iso.lake.lake.data[k]) src = 'lake';
          else if (insideRing({ x, y }, iso.airport.field)) src = 'airport';
          else if (iso.towns.owner[k]) src = towns[iso.towns.owner[k]! - 1]!.id;
          else src = 'wild';
          votes.set(src, (votes.get(src) ?? 0) + 1);
        }
      }
      // Majority; ties go to the first source in a fixed order (towns before wild, so small patches stay built).
      const order = ['airport', ...towns.map((t) => t.id), 'lake', 'sea', 'wild'];
      let best = 'wild';
      let bestN = -1;
      for (const src of order) {
        const n = votes.get(src) ?? 0;
        if (n > bestN) {
          best = src;
          bestN = n;
        }
      }
      row.push(code(best));
    }
    out.push(row);
  }
  return out;
}

export function gameSpecFromIsthmus(spec: WorldSpec, iso: Isthmus): GameSpec {
  const G = spec.procedural.game;
  const rect = act1Rect(iso, G.rectMargin, spec.bounds);
  const grid = districtGrid(spec, iso);
  const rows = grid.length;
  const districtAt = (p: Vec2): string => {
    const c = Math.min(grid[0]!.length - 1, Math.max(0, Math.floor(p.x / G.districtCell)));
    const r = Math.min(rows - 1, Math.max(0, rows - 1 - Math.floor(p.y / G.districtCell)));
    const code = grid[r]![c]!;
    return spec.districts.find((d) => d.code === code)!.id;
  };
  const inRect = (p: Vec2): boolean => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;

  const placed = new Map(iso.landmarks.map((l) => [l.id, l] as const));
  const dropped: string[] = [];
  const landmarks: Landmark[] = [];
  for (const l of spec.landmarks) {
    const pl = placed.get(l.id);
    const at = pl?.at;
    if (pl && at) landmarks.push({ ...l, position: { x: at.x, y: at.y }, district: districtAt(at), ...(pl.heading !== undefined ? { heading: pl.heading } : {}) });
    else if (inRect(l.position)) dropped.push(l.id);
    else landmarks.push(l);
  }

  const routes: Route[] = [
    ...iso.roads.paths.map((p) => ({ id: p.id, kind: p.kind, points: p.points.map((q) => ({ x: q.x, y: q.y })) })),
    ...iso.airport.runways.map((rw, k) => ({ id: `runway-${k + 1}`, kind: 'runway', width: rw.width, points: [rw.a, rw.b] })),
    { id: 'canal', kind: 'waterway', points: iso.canal.centreline.map((q) => ({ x: q.x, y: q.y })) },
  ];

  const districts = spec.districts.map((d) => {
    if (!d.labelAt || districtAt(d.labelAt) === d.id) return d;
    const { labelAt: _, ...rest } = d;
    return rest;
  });

  const activeArea = { ...spec.activeArea, x: [rect.minX, rect.maxX] as [number, number], y: [rect.minY, rect.maxY] as [number, number] };
  return {
    spec: { ...spec, bounds: { ...spec.bounds, cellSize: G.districtCell }, grid, districts, landmarks, routes, activeArea },
    dropped,
  };
}
