import type { TriSoup } from './street-surface.ts';
import type { Vec2 } from './vec.ts';
import type { Rect } from './geometry.ts';
import type { PcPolygon, Poly } from './streets/poly.ts';
import { intersection } from './streets/poly.ts';

export interface DrapeOptions {
  /** Edges longer than this (m) are always split. */
  maxEdge: number;
  /** Edges at most this long (m) are never split, whatever the terrain does. */
  minEdge: number;
  /** An edge is split while the terrain at any edge midpoint is this far (m) from the straight line between its ends. */
  tolerance: number;
}

/**
 * Subdivides a flat triangle soup (spec plane) so it can be draped over the terrain (per-vertex
 * height = heightAt): adaptive, so flat ground keeps big triangles and hills / graded streets get
 * small ones. Longest-edge bisection: a triangle splits its longest edge while that edge exceeds
 * `maxEdge`, or exceeds `minEdge` and the terrain at one of the triangle's edge midpoints departs
 * from the chord by more than `tolerance`. Thin ribbons stay thin, midpoints are shared through a
 * per-edge cache. A final pass splits any triangle
 * whose edge a neighbour split, so the mesh stays watertight. Winding is preserved.
 */
export function drapeSoup(soup: TriSoup, heightAt: (x: number, y: number) => number, opts: DrapeOptions): TriSoup {
  const pos: number[] = soup.positions.slice();
  const hts: number[] = [];
  const out: number[] = [];
  const mid = new Map<number, number>();
  const BASE = 1 << 24; // vertex ids stay below this: key = lo * BASE + hi stays an exact integer

  const h = (v: number): number => {
    let r = hts[v];
    if (r === undefined) {
      r = heightAt(pos[v * 2] as number, pos[v * 2 + 1] as number);
      hts[v] = r;
    }
    return r;
  };
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? a * BASE + b : b * BASE + a;
    let m = mid.get(key);
    if (m === undefined) {
      m = pos.length / 2;
      pos.push(((pos[a * 2] as number) + (pos[b * 2] as number)) / 2, ((pos[a * 2 + 1] as number) + (pos[b * 2 + 1] as number)) / 2);
      mid.set(key, m);
    }
    return m;
  };
  const len2 = (a: number, b: number): number => {
    const dx = (pos[a * 2] as number) - (pos[b * 2] as number);
    const dy = (pos[a * 2 + 1] as number) - (pos[b * 2 + 1] as number);
    return dx * dx + dy * dy;
  };
  /** Terrain departure from the chord a-b at its midpoint. */
  const chordError = (a: number, b: number): number => {
    const x = ((pos[a * 2] as number) + (pos[b * 2] as number)) / 2;
    const y = ((pos[a * 2 + 1] as number) + (pos[b * 2 + 1] as number)) / 2;
    return Math.abs(heightAt(x, y) - (h(a) + h(b)) / 2);
  };

  // Weld vertices at the same position (ribbon pieces carry their own copies), so neighbouring
  // triangles agree on the vertex ids of a shared edge and therefore on its midpoint.
  const canon = new Map<number, number>();
  const weld = (v: number): number => {
    const key = Math.round((pos[v * 2] as number) * 1000) * 67108864 + Math.round((pos[v * 2 + 1] as number) * 1000);
    const known = canon.get(key);
    if (known !== undefined) return known;
    canon.set(key, v);
    return v;
  };
  const src = soup.indices.map(weld);

  const max2 = opts.maxEdge * opts.maxEdge;
  const min2 = opts.minEdge * opts.minEdge;
  const stack: number[] = [];
  const leaves: number[] = [];
  for (let i = src.length - 3; i >= 0; i -= 3) {
    stack.push(src[i] as number, src[i + 1] as number, src[i + 2] as number);
    while (stack.length > 0) {
      const c = stack.pop() as number;
      const b = stack.pop() as number;
      const a = stack.pop() as number;
      const ab = len2(a, b);
      const bc = len2(b, c);
      const ca = len2(c, a);
      const longest = Math.max(ab, bc, ca);
      const split =
        longest > max2 ||
        (longest > min2 && (chordError(a, b) > opts.tolerance || chordError(b, c) > opts.tolerance || chordError(c, a) > opts.tolerance));
      if (!split) {
        leaves.push(a, b, c);
      } else if (longest === ab) {
        const m = midpoint(a, b);
        stack.push(m, b, c, a, m, c);
      } else if (longest === bc) {
        const m = midpoint(b, c);
        stack.push(a, m, c, a, b, m);
      } else {
        const m = midpoint(c, a);
        stack.push(m, a, b, m, b, c);
      }
    }
  }

  // Close the seams: a leaf whose edge was split by its neighbour gets that midpoint too (and so on
  // for the pieces), so adjacent triangles always share their vertices: no T-junction cracks.
  const midOf = (a: number, b: number): number | undefined => mid.get(a < b ? a * BASE + b : b * BASE + a);
  for (let i = 0; i < leaves.length; i += 3) {
    stack.push(leaves[i] as number, leaves[i + 1] as number, leaves[i + 2] as number);
    while (stack.length > 0) {
      const c = stack.pop() as number;
      const b = stack.pop() as number;
      const a = stack.pop() as number;
      const mab = midOf(a, b);
      const mbc = midOf(b, c);
      const mca = midOf(c, a);
      if (mab !== undefined) stack.push(mab, b, c, a, mab, c);
      else if (mbc !== undefined) stack.push(a, mbc, c, a, b, mbc);
      else if (mca !== undefined) stack.push(mca, a, b, mca, b, c);
      else out.push(a, b, c);
    }
  }
  return { positions: pos, indices: out };
}

/** The land polygon clipped to `rect`, as polygons with holes (ready for triangulation). */
export function clipLandToRect(land: readonly Vec2[], rect: Rect): Poly[] {
  const box: PcPolygon = [[[rect.minX, rect.minY], [rect.maxX, rect.minY], [rect.maxX, rect.maxY], [rect.minX, rect.maxY], [rect.minX, rect.minY]]];
  return intersection({ outer: land.map((p) => ({ x: p.x, y: p.y })), holes: [] }, box) ?? [];
}
