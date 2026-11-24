/**
 * Human scale (`scale:` in specs/map/world.yaml): one fixed set of measures that every generator and
 * test reads, so streets and buildings stay in proportion to a 1.8 m person. Pure: no I/O.
 *
 *   human         m, Tito's height (src/sim/body.ts must match)
 *   storey        m, floor-to-floor; generated building heights are whole storeys
 *   door          m, { width, height } of a street door; a storey must fit one
 *   lane          m, [min, max] width of one traffic lane; a traffic carriageway holds whole lanes
 *   sidewalkMin   m, a sidewalk is either 0 (none) or at least this wide
 *   traffic       street_profiles kinds that carry lanes (every generated street class does too)
 */

export interface ScaleSpec {
  human: number;
  storey: number;
  door: { width: number; height: number };
  lane: readonly [number, number];
  sidewalkMin: number;
  traffic: string[];
}

/** Whole lanes `width` holds: the smallest n >= 1 with n·lane[0] <= width <= n·lane[1], else null. */
export function wholeLanes(width: number, lane: readonly [number, number]): number | null {
  if (!(width > 0) || !(lane[0] > 0) || !(lane[1] >= lane[0])) return null;
  const n = Math.max(1, Math.ceil(width / lane[1] - 1e-9));
  return n * lane[0] <= width + 1e-9 ? n : null;
}

/** Problems of one street cross-section against the scale rules (empty when it complies). */
export function streetScaleProblems(path: string, p: { width: number; sidewalk: number }, scale: ScaleSpec): string[] {
  const out: string[] = [];
  if (wholeLanes(p.width, scale.lane) === null) {
    out.push(`${path}.width: ${p.width} m is not a whole number of ${scale.lane[0]}–${scale.lane[1]} m lanes (scale.lane)`);
  }
  if (p.sidewalk !== 0 && !(p.sidewalk >= scale.sidewalkMin)) {
    out.push(`${path}.sidewalk: ${p.sidewalk} m must be 0 or at least ${scale.sidewalkMin} m (scale.sidewalk_min)`);
  }
  return out;
}

/** Storey counts [min, max] whose heights fall inside `range`, or null when no whole storey fits. */
export function storeyRange(range: readonly [number, number], storey: number): [number, number] | null {
  if (!(storey > 0)) return null;
  const lo = Math.max(1, Math.ceil(range[0] / storey - 1e-9));
  const hi = Math.floor(range[1] / storey + 1e-9);
  return lo <= hi ? [lo, hi] : null;
}

/** A drawn height rounded to whole storeys, kept inside the storey counts that fit `range`. */
export function wholeStoreyHeight(drawn: number, range: readonly [number, number], storey: number): number {
  const fit = storeyRange(range, storey);
  if (!fit) throw new Error(`no whole ${storey} m storey fits in [${range[0]}, ${range[1]}] m`);
  const n = Math.min(fit[1], Math.max(fit[0], Math.round(drawn / storey)));
  return n * storey;
}

/** Is `height` a whole number (>= 1) of storeys? */
export function isWholeStoreys(height: number, storey: number): boolean {
  const n = Math.round(height / storey);
  return n >= 1 && Math.abs(n * storey - height) < 1e-6;
}
