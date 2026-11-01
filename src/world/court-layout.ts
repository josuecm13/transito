/**
 * Sport-court layout inside a court block's buildable part (render helper, pure).
 *
 * The court is a rectangle aligned with the part's minimum-area bounding box, at most
 * COURT_SIZE (a futsal court, the size `land-use.ts` COURT_MIN_AREA is based on) and at least
 * `margin` m inside the part. Tried at the box centre and at the part centroid, shrinking 15% per
 * try; undefined when nothing fits (the caller then paints the whole part).
 */
import type { Vec2 } from './vec.ts';
import type { Poly } from './streets/poly.ts';
import { minAreaObb, ringCentroid, ringInsidePoly } from './streets/poly.ts';
import type { TriSoup } from './street-surface.ts';
import { emptySoup, pushBand, ringOutline } from './street-surface.ts';

export const COURT_SIZE = { long: 40, short: 20 } as const;

const SCALES = [1, 0.85, 0.72, 0.61, 0.52];

/** Counter-clockwise rectangle of the court, or undefined if no court fits. */
export function courtRect(part: Poly, margin = 1.5, size: { long: number; short: number } = COURT_SIZE): Vec2[] | undefined {
  if (part.outer.length < 3) return undefined;
  const obb = minAreaObb(part.outer);
  const u = obb.axis;
  const v = { x: -u.y, y: u.x };
  const long0 = Math.min(size.long, obb.long - 2 * margin);
  const short0 = Math.min(size.short, obb.short - 2 * margin);
  if (long0 <= 0 || short0 <= 0) return undefined;
  for (const s of SCALES) {
    const hl = (long0 * s) / 2;
    const hs = (short0 * s) / 2;
    for (const c of [obb.center, ringCentroid(part.outer)]) {
      const rect = [
        { x: c.x - u.x * hl - v.x * hs, y: c.y - u.y * hl - v.y * hs },
        { x: c.x + u.x * hl - v.x * hs, y: c.y + u.y * hl - v.y * hs },
        { x: c.x + u.x * hl + v.x * hs, y: c.y + u.y * hl + v.y * hs },
        { x: c.x - u.x * hl + v.x * hs, y: c.y - u.y * hl + v.y * hs },
      ];
      if (ringInsidePoly(rect, part, margin - 1e-6)) return rect; // slack for rounding at an exact fit
    }
  }
  return undefined;
}

/** Painted lines of a court rectangle (from courtRect): border just inside it plus the halfway line. */
export function courtLines(rect: readonly Vec2[], width: number): TriSoup {
  if (rect.length !== 4) return emptySoup();
  const s = ringOutline(rect, width);
  const [a, b, c, d] = rect as [Vec2, Vec2, Vec2, Vec2];
  const mid = (p: Vec2, q: Vec2): Vec2 => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  // Halfway line from the middle of side a-b to the middle of side c-d (across the short side).
  pushBand(s, mid(a, b), mid(d, c), -width / 2, width / 2);
  return s;
}
