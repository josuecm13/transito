/**
 * Section generator parameters: everything is derived from the section profile (specs/map/sections/*.json,
 * validated by parseSectionProfile in src/world/spec.ts) or from the world spec. The only numbers in
 * this folder that are not profile data are named, documented implementation resolutions (RASTER_STEP,
 * the guard distances in network.ts) and never decide the look of a street.
 */
import type { Percentiles, SectionProfile } from '../../spec.ts';
import * as D from './dmath.ts';

export interface Family {
  /** Orientation, radians in [0, pi): angle of the street line from +x (counter-clockwise). */
  rad: number;
  share: number;
}

export interface SectionParams {
  /** Street class of the boundary road and of the openings. */
  boundaryClass: string;
  portWidth: number;
  openings: { min: number; max: number };
  families: Family[];
  /** Every family direction and its perpendicular (radians in [0, pi)). */
  directions: number[];
  /** Direction jitter of one street (radians): makes corners fall within 15 deg of 90 as often as measured. */
  jitter: number;
  /** Largest deviation of a block side from its chord, as a fraction of the chord (edge_irregularity_p90). */
  irregularityP90: number;
  /** sigma of |N(0, sigma)| whose 90th percentile is irregularityP90. */
  irregularitySigma: number;
  segment: { p10: number; p50: number; p90: number };
  mix: { deadEnd: number; t: number; x: number };
  /** Faces per junction node implied by the mix (Euler): sum(share * degree) / 2 - 1. */
  facesPerNode: number;
  minAngleP10: number;
  /** Block area quantiles (m2), log-normal sigma and the p99 beyond which a face is not a fabric block. */
  block: { p10: number; p50: number; p90: number; sigma: number; elongationP50: number; elongationAim: number };
  intersectionsPerKm2: number;
  streetKmPerKm2: number;
}

/** Inverse of the standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p <= 0 || p >= 1) throw new Error(`normalQuantile: p=${p} outside (0, 1)`);
  const [a0, a1, a2, a3, a4, a5] = a as [number, number, number, number, number, number];
  const [b0, b1, b2, b3, b4] = b as [number, number, number, number, number];
  const [c0, c1, c2, c3, c4, c5] = c as [number, number, number, number, number, number];
  const [d0, d1, d2, d3] = d as [number, number, number, number];
  if (p < lo) {
    const q = Math.sqrt(-2 * D.log(p));
    return (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) / ((((d0 * q + d1) * q + d2) * q + d3) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) / (((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1);
}

const num = (o: unknown, key: string): number => {
  const v = (o as Record<string, unknown>)[key];
  if (typeof v !== 'number') throw new Error(`section profile: ${key} is not a number`);
  return v;
};
const pct = (o: unknown): Percentiles => o as Percentiles;

const norm = (a: number): number => ((a % Math.PI) + Math.PI) % Math.PI;

export function sectionParams(profile: SectionProfile): SectionParams {
  const net = profile.network;
  const blocks = profile.blocks;
  const fam = (net.orientation_families as { deg: number; share: number }[]).map((f) => ({ rad: norm((f.deg * Math.PI) / 180), share: f.share }));
  const directions: number[] = [];
  for (const f of fam) directions.push(f.rad, norm(f.rad + Math.PI / 2));
  const seg = pct(net.segment_length_m);
  const mix = net.junction_mix as { dead_end: number; t: number; x: number };
  const area = pct(blocks.area_m2);
  const within15 = num(blocks, 'share_corners_within_15deg_of_90');
  // Corners are made of two streets, each jittered: P(|corner error| > 15 deg) = 1 - share  =>  sigma_corner.
  const sigmaCorner = (15 * Math.PI) / 180 / normalQuantile(1 - (1 - within15) / 2);
  const irr = num(net, 'edge_irregularity_p90');
  const junctionAngle = pct(net.min_junction_angle_deg);
  return {
    boundaryClass: profile.ports.default_class,
    portWidth: profile.ports.width_m,
    openings: profile.boundary.openings,
    families: fam,
    directions,
    jitter: sigmaCorner / Math.SQRT2,
    irregularityP90: irr,
    irregularitySigma: irr / normalQuantile(0.95),
    segment: { p10: seg.p10, p50: seg.p50, p90: seg.p90 },
    mix: { deadEnd: mix.dead_end, t: mix.t, x: mix.x },
    facesPerNode: (mix.dead_end + 3 * mix.t + 4 * mix.x) / 2 - 1,
    minAngleP10: junctionAngle.p10,
    block: {
      p10: area.p10,
      p50: area.p50,
      p90: area.p90,
      sigma: D.log(area.p90 / area.p10) / (2 * normalQuantile(0.9)),
      elongationP50: pct(blocks.elongation).p50,
      // The reference sits at the low end of what the surrounding fragments show, and the cuts realise only about 0.6 of their aim
      // in log terms (measured on Act 1 and on rectangles, aim 2.34 -> 1.7, aim 3.0 -> 1.9): aim above the top of the band.
      elongationAim: elongationAim(profile),
    },
    intersectionsPerKm2: num(net, 'intersections_per_km2'),
    streetKmPerKm2: num(net, 'street_km_per_km2'),
  };
}

/** Quantile of the log-normal fitted to a block-area band (median p50, sigma from p10..p90). */
export function areaQuantile(b: SectionParams['block'], u: number): number {
  return b.p50 * D.exp(b.sigma * normalQuantile(Math.min(1 - 1e-9, Math.max(1e-9, u))));
}

/** Generator-side calibration (not profile data): how far above the wanted elongation the cuts must aim. */
const CUT_FALLS_SHORT = 1.3;

function elongationAim(profile: SectionProfile): number {
  const ref = pct(profile.blocks.elongation).p50;
  const r = profile.range.block_elongation_p50;
  return r && r.min > 0 && r.max >= r.min ? r.max * CUT_FALLS_SHORT : ref * CUT_FALLS_SHORT;
}
