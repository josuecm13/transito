/**
 * Rivers and the canal (docs/map-reshape/01-investigation/procedural-techniques.md §2).
 *
 * - extractRivers: channels are cells whose drainage area exceeds a threshold; segments run between
 *   channel heads and confluences, width = a √Q (Leopold & Maddock 1953) with Q ∝ drainage area.
 * - routeCanal: the canal is the cheapest excavation: from the Caribbean to the dam (the Atlantic
 *   locks sit at the dam), across the reservoir, over the lowest pass of the divide to the Pacific
 *   locks, then to the Pacific. Cost per metre grows with the depth to dig below the ground, so the
 *   cut finds the saddle by itself.
 */
import type { Vec2 } from '../vec.ts';
import { centreX, centreY, mask, type FieldGrid, type GridShape, type MaskGrid } from './grid.ts';
import type { FlowRouting } from './hydrology.ts';
import { cellsToPoints, chaikin, leastCostPath, simplify } from './paths.ts';

export interface RiverParams {
  /** Minimum drainage area of a drawn channel, km². */
  readonly minAreaKm2: number;
  /** Width (m) of a channel draining 1 km²; width = a √(area km²). */
  readonly widthPerSqrtKm2: number;
  readonly maxWidth: number;
}

export interface RiverSegment {
  readonly points: readonly Vec2[];
  readonly width: number;
  /** Drainage area at the downstream end, km². */
  readonly areaKm2: number;
}

export function extractRivers(g: GridShape, land: MaskGrid, lake: MaskGrid, routing: FlowRouting, area: Float64Array, p: RiverParams): RiverSegment[] {
  const n = g.w * g.h;
  const minA = p.minAreaKm2 * 1e6;
  const isCh = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (land.data[i] && !lake.data[i] && area[i]! >= minA) isCh[i] = 1;
  const donors = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = routing.receiver[i]!;
    if (isCh[i] && r !== i && isCh[r]) donors[r] = Math.min(255, donors[r]! + 1);
  }
  const segs: RiverSegment[] = [];
  for (let s = 0; s < n; s++) {
    if (!isCh[s] || (donors[s] !== 0 && donors[s]! < 2)) continue; // starts: heads and confluences
    const cells = [s];
    let c = s;
    for (;;) {
      const r = routing.receiver[c]!;
      if (r === c) break;
      cells.push(r);
      if (!isCh[r] || donors[r]! >= 2) break; // reached sea / lake / next confluence
      c = r;
    }
    if (cells.length < 2) continue;
    const end = cells[cells.length - 1]!;
    const last = isCh[end] ? end : cells[cells.length - 2]!;
    const aKm2 = area[last]! / 1e6;
    const pts = chaikin(simplify(cellsToPoints(g, cells), g.cell * 0.4), 2);
    segs.push({ points: pts, width: Math.min(p.maxWidth, Math.max(3, p.widthPerSqrtKm2 * Math.sqrt(aKm2))), areaKm2: aKm2 });
  }
  return segs;
}

export interface CanalParams {
  /** A sea point in the Caribbean bay where the canal starts. */
  readonly caribbean: Vec2;
  /** Where the canal steps down to the Pacific (hint for the Pacific locks). */
  readonly pacificLocks: Vec2;
  /** A sea point in the Pacific where the canal ends. */
  readonly pacific: Vec2;
  /** Channel width (m). */
  readonly width: number;
  /** Channel depth below its water level (m). */
  readonly depth: number;
  /** Excavation cost weight per metre of ground above the water level. */
  readonly digWeight: number;
}

export interface CanalResult {
  readonly centreline: readonly Vec2[];
  /** Atlantic locks (at the dam) and Pacific locks, with the canal direction there (unit vector). */
  readonly locks: readonly { readonly id: string; readonly at: Vec2; readonly dir: Vec2; readonly steps: number }[];
  readonly channel: MaskGrid;
}

export function routeCanal(height: FieldGrid, lake: MaskGrid, lakeLevel: number, dam: Vec2, p: CanalParams): CanalResult {
  const hd = height.data;
  const cost = (level: number) => (_a: number, b: number, len: number, mid: number): number => {
    if (lake.data[b] || hd[b]! < 0) return len * 0.25;
    const dig = Math.max(0, Math.max(hd[b]!, hd[mid]!) - level);
    return len * (1 + p.digWeight * dig);
  };
  const leg = (from: Vec2, to: Vec2, level: number): Vec2[] => cellsToPoints(height, leastCostPath(height, from, to, cost(level), 0.25));
  const a = leg(p.caribbean, dam, 0);
  const b = leg(dam, p.pacificLocks, lakeLevel);
  const c = leg(p.pacificLocks, p.pacific, 0);
  const raw = [...a, ...b.slice(1), ...c.slice(1)];
  const centreline = chaikin(simplify(raw, height.cell * 1.5), 3);
  const dirAt = (pts: readonly Vec2[], at: Vec2): Vec2 => {
    let best = 0;
    let bd = Infinity;
    pts.forEach((q, i) => {
      const d = Math.hypot(q.x - at.x, q.y - at.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    const q0 = pts[Math.max(0, best - 3)]!;
    const q1 = pts[Math.min(pts.length - 1, best + 3)]!;
    const l = Math.hypot(q1.x - q0.x, q1.y - q0.y) || 1;
    return { x: (q1.x - q0.x) / l, y: (q1.y - q0.y) / l };
  };
  const channel = mask(height);
  const r = p.width / 2;
  for (let gy = 0; gy < height.h; gy++) {
    for (let gx = 0; gx < height.w; gx++) {
      const x = centreX(height, gx);
      const y = centreY(height, gy);
      for (let k = 1; k < centreline.length; k++) {
        const s0 = centreline[k - 1]!;
        const s1 = centreline[k]!;
        const dx = s1.x - s0.x;
        const dy = s1.y - s0.y;
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.min(1, Math.max(0, ((x - s0.x) * dx + (y - s0.y) * dy) / l2));
        if (Math.hypot(x - s0.x - t * dx, y - s0.y - t * dy) <= r) {
          channel.data[gy * height.w + gx] = 1;
          break;
        }
      }
    }
  }
  return {
    centreline,
    locks: [
      { id: 'atlantic-locks', at: dam, dir: dirAt(centreline, dam), steps: 3 },
      { id: 'pacific-locks', at: p.pacificLocks, dir: dirAt(centreline, p.pacificLocks), steps: 2 },
    ],
    channel,
  };
}
