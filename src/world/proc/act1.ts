/**
 * Act 1 placement on the generated map (#12 2.2; `procedural.act1:` in world.yaml). Pure.
 *
 * The director placed Act 1 by structure, not by coordinates: Tito's barrio is the midpoint of the
 * branch of Línea 2 that ends at the airport, and the act's strip runs along that track from the
 * barrio to the airport. So everything here is derived from the routed transit track; when the
 * generator moves the line, Act 1 moves with it.
 */
import type { Vec2 } from '../vec.ts';
import { cellAt, type GridShape, type MaskGrid } from './grid.ts';

export interface Act1Params {
  /** Transit line id. */
  readonly line: string;
  /** Index of the line's branch to follow (the one ending at `branch_to`, resolved by the caller). */
  readonly branch: number;
  /** Fraction (0..1) of the branch's track length where the barrio is centred. */
  readonly anchorAt: number;
  /** Town index (into the growth result) the barrio belongs to. */
  readonly town: number;
  readonly barrioRadius: number;
  readonly stripHalfWidth: number;
}

export interface Act1Placement {
  /** Centre of Tito's barrio: the point at `anchorAt` of the track's length. */
  readonly anchor: Vec2;
  readonly barrio: { readonly centre: Vec2; readonly radius: number };
  /** The track from the anchor to the branch end; the act's area is this line buffered by `halfWidth`. */
  readonly strip: { readonly centreline: readonly Vec2[]; readonly halfWidth: number; readonly lengthM: number };
  /** Share (0..1) of the built cells within the barrio radius that belong to the act's town. */
  readonly townShare: number;
  /** Dry ground at the anchor (land, not lake). */
  readonly anchorDry: boolean;
}

export function trackLength(track: readonly Vec2[]): number {
  let L = 0;
  for (let k = 1; k < track.length; k++) L += Math.hypot(track[k]!.x - track[k - 1]!.x, track[k]!.y - track[k - 1]!.y);
  return L;
}

/** Splits `track` at `fraction` of its length: the point there and the remaining polyline from it to the end. */
export function splitAt(track: readonly Vec2[], fraction: number): { point: Vec2; rest: Vec2[] } {
  if (track.length < 2) throw new Error('splitAt: track needs at least 2 points');
  const target = trackLength(track) * Math.min(1, Math.max(0, fraction));
  let acc = 0;
  for (let k = 1; k < track.length; k++) {
    const a = track[k - 1]!;
    const b = track[k]!;
    const s = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + s >= target && s > 0) {
      const f = (target - acc) / s;
      const point = { x: a.x + f * (b.x - a.x), y: a.y + f * (b.y - a.y) };
      return { point, rest: [point, ...track.slice(k)] };
    }
    acc += s;
  }
  const end = track[track.length - 1]!;
  return { point: end, rest: [end] };
}

export function placeAct1(
  track: readonly Vec2[],
  owner: Uint8Array,
  shape: GridShape,
  land: MaskGrid,
  lake: MaskGrid,
  p: Act1Params,
): Act1Placement {
  const { point: anchor, rest } = splitAt(track, p.anchorAt);
  const { w, h, cell } = shape;
  let built = 0;
  let mine = 0;
  const r = Math.ceil(p.barrioRadius / cell);
  const c0 = cellAt(shape, anchor.x, anchor.y);
  const cx = c0 % w;
  const cy = (c0 - cx) / w;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      if (Math.hypot((gx + 0.5) * cell - anchor.x, (gy + 0.5) * cell - anchor.y) > p.barrioRadius) continue;
      const o = owner[gy * w + gx]!;
      if (o === 0) continue;
      built++;
      if (o === p.town + 1) mine++;
    }
  }
  const at = cellAt(land, anchor.x, anchor.y);
  return {
    anchor,
    barrio: { centre: anchor, radius: p.barrioRadius },
    strip: { centreline: rest, halfWidth: p.stripHalfWidth, lengthM: trackLength(rest) },
    townShare: built > 0 ? mine / built : 0,
    anchorDry: land.data[at] === 1 && lake.data[cellAt(lake, anchor.x, anchor.y)] !== 1,
  };
}
