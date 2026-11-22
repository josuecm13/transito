/**
 * Main roads and the railway by slope-cost routing (Galin et al. 2010). Edge cost per metre:
 *   1 + k (grade / g0)², infinite above the grade limit,
 * times a water factor (bridge) for river, canal and sea cells; the reservoir is impassable. Roads
 * bend around ridges and climb at gentle grades because that is cheapest, not because they are drawn.
 * Each route goes through its stops in order; later routes reuse earlier roads at a discount, so the
 * network shares trunks instead of running parallel.
 */
import type { Vec2 } from '../vec.ts';
import { mask, type FieldGrid, type MaskGrid } from './grid.ts';
import { leastCostPath, smoothAvoiding } from './paths.ts';

export interface RouteSpec {
  readonly id: string;
  readonly kind: 'highway' | 'road' | 'rail';
  /** Stops, in order (map points). */
  readonly stops: readonly Vec2[];
}

export interface RoadParams {
  readonly routes: readonly RouteSpec[];
  /** Grade scale g0 and weight k per kind; `maxGrade` blocks steeper edges. */
  readonly grade: Record<RouteSpec['kind'], { readonly g0: number; readonly k: number; readonly maxGrade: number }>;
  /** Cost multiplier for a cell of river / sea (bridge). */
  readonly bridge: number;
  /** Cost multiplier for a sea cell (causeway). */
  readonly seaBridge: number;
  /** Cost multiplier for a canal cell (`wet` value 2): canal bridges are rare and expensive. */
  readonly canalBridge: number;
  /** Cost multiplier on cells already used by an earlier route of the same mode (road or rail). */
  readonly reuse: number;
}

export interface RoadPath {
  readonly id: string;
  readonly kind: RouteSpec['kind'];
  readonly points: readonly Vec2[];
  readonly cells: readonly number[];
}

export interface RoadsResult {
  readonly paths: readonly RoadPath[];
  /** 1 where a road or rail passes (cells). */
  readonly used: MaskGrid;
}

/** Nearest dry, non-lake cell centre to `p` (ring search), so authored stops never sit in water. */
export function snapToDry(g: MaskGrid, lake: MaskGrid, wet: MaskGrid, p: Vec2): Vec2 {
  const cx = Math.min(g.w - 1, Math.max(0, Math.floor(p.x / g.cell)));
  const cy = Math.min(g.h - 1, Math.max(0, Math.floor(p.y / g.cell)));
  for (let r = 0; r < Math.max(g.w, g.h); r++) {
    let best = -1;
    let bd = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        const i = y * g.w + x;
        if (!g.data[i] || lake.data[i] || wet.data[i]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    if (best >= 0) return { x: ((best % g.w) + 0.5) * g.cell, y: (Math.floor(best / g.w) + 0.5) * g.cell };
  }
  return p;
}

export function routeRoads(height: FieldGrid, land: MaskGrid, lake: MaskGrid, wet: MaskGrid, p: RoadParams): RoadsResult {
  const hd = height.data;
  const roadUsed = mask(height);
  const railUsed = mask(height);
  const used = mask(height);
  const paths: RoadPath[] = [];
  for (const r of p.routes) {
    const gp = p.grade[r.kind];
    const reuseMask = r.kind === 'rail' ? railUsed : roadUsed;
    const cost = (a: number, b: number, len: number, mid: number): number => {
      if (lake.data[b] || lake.data[mid]) return Number.POSITIVE_INFINITY;
      const water = !land.data[b] || !land.data[mid] || wet.data[b] || wet.data[mid];
      const ha = Math.max(0, hd[a]!);
      const hb = Math.max(0, hd[b]!);
      const grade = water ? 0 : Math.abs(hb - ha) / len;
      if (grade > gp.maxGrade) return Number.POSITIVE_INFINITY;
      let c = len * (1 + gp.k * (grade / gp.g0) ** 2);
      if (water) c *= wet.data[b] === 2 || wet.data[mid] === 2 ? p.canalBridge : !land.data[b] ? p.seaBridge : p.bridge;
      if (reuseMask.data[b]) c *= p.reuse;
      return c;
    };
    const cells: number[] = [];
    for (let s = 1; s < r.stops.length; s++) {
      const leg = leastCostPath(height, snapToDry(land, lake, wet, r.stops[s - 1]!), snapToDry(land, lake, wet, r.stops[s]!), cost, p.reuse);
      if (leg.length === 0) throw new Error(`routeRoads: ${r.id} leg ${s} unreachable`);
      cells.push(...(cells.length ? leg.slice(1) : leg));
    }
    for (const c of cells) {
      reuseMask.data[c] = 1;
      used.data[c] = 1;
    }
    const pts = smoothAvoiding(height, cells, lake);
    paths.push({ id: r.id, kind: r.kind, points: pts, cells });
  }
  return { paths, used };
}

/** Cells within `radius` metres of any road cell (for settlement growth). */
export function nearRoads(used: MaskGrid, radius: number): MaskGrid {
  const out = mask(used);
  const r = Math.ceil(radius / used.cell);
  for (let i = 0; i < used.data.length; i++) {
    if (!used.data[i]) continue;
    const x0 = i % used.w;
    const y0 = (i - x0) / used.w;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x >= 0 && y >= 0 && x < used.w && y < used.h) out.data[y * used.w + x] = 1;
      }
    }
  }
  return out;
}

