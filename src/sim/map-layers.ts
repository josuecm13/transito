import type { HeightGrid } from '../world/height-grid.ts';

/** Map colours of the land-cover classes (layer 1), '#rrggbb'. Water is the sea colour of the map screens. */
export const COVER_MAP_COLORS: Record<string, string> = {
  water: '#1d4e7a',
  forest: '#2c5632',
  clearing: '#86974f',
  grass: '#78a05a',
  mangrove: '#5d6b3c',
  urban_prior: '#b3aa98',
  park_reclaimed: '#9cc87a',
};
const FALLBACK_COVER = '#56614f';

export type Rgb = readonly [number, number, number];

export function parseHex(h: string): Rgb {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** Cover class name -> RGB (unknown classes get a neutral land green). */
export function coverColor(name: string): Rgb {
  return parseHex(COVER_MAP_COLORS[name] ?? FALLBACK_COVER);
}

/** Bilinear height at spec (x, y), clamped to the grid. */
export function gridHeight(g: HeightGrid, x: number, y: number): number {
  const fx = Math.min(g.cols - 1, Math.max(0, (x - g.x0) / g.cell));
  const fy = Math.min(g.rows - 1, Math.max(0, (y - g.y0) / g.cell));
  const i = Math.min(g.cols - 2, Math.floor(fx));
  const j = Math.min(g.rows - 2, Math.floor(fy));
  const tx = fx - i;
  const ty = fy - j;
  const at = (a: number, b: number): number => g.data[b * g.cols + a] as number;
  return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
}

/** Light direction (unit, pointing toward the light): north-west, 45 degrees above the horizon. Spec plane, +x east, +y north. */
const LIGHT = (() => {
  const az = Math.PI * 0.75; // NW: x < 0, y > 0
  const el = Math.PI / 4;
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)] as const;
})();
/** Vertical exaggeration of the relief so ridges read at isthmus scale. */
export const HILLSHADE_EXAGGERATION = 4;

/**
 * Lambert hillshade at spec (x, y), 0 (dark) .. ~1 (bright), 0.7071 on flat ground (light at 45 degrees).
 * Slopes facing north-west are brighter than slopes facing south-east.
 */
export function hillshadeAt(g: HeightGrid, x: number, y: number, exaggeration = HILLSHADE_EXAGGERATION): number {
  const d = g.cell;
  const dzdx = ((gridHeight(g, x + d, y) - gridHeight(g, x - d, y)) / (2 * d)) * exaggeration;
  const dzdy = ((gridHeight(g, x, y + d) - gridHeight(g, x, y - d)) / (2 * d)) * exaggeration;
  const inv = 1 / Math.hypot(dzdx, dzdy, 1);
  const lambert = (-dzdx * LIGHT[0] - dzdy * LIGHT[1] + LIGHT[2]) * inv;
  return Math.min(1, Math.max(0, lambert));
}

/** Multiplier applied to the cover colour for a hillshade value: flat ground (0.7071) stays 1. */
export function shadeFactor(shade: number, strength = 0.9): number {
  return 1 + (shade / Math.SQRT1_2 - 1) * strength;
}

/** Cover colour darkened / lightened by relief and forest density (denser reads darker, as in the 3D far ground). */
export function shadedCoverColor(name: string, shade: number, density: number): Rgb {
  const [r, g, b] = coverColor(name);
  const land = name !== 'water';
  const k = land ? shadeFactor(shade) * (0.9 + 0.2 * (1 - density)) : 1;
  const c = (v: number): number => Math.min(255, Math.max(0, Math.round(v * k)));
  return [c(r), c(g), c(b)];
}

/** Pixel grid of a rect rendered north-up at `metersPerPx`: spec -> pixel (shared by the base image and its consumers). */
export interface PixelFrame {
  readonly minX: number;
  readonly maxY: number;
  readonly metersPerPx: number;
  readonly w: number;
  readonly h: number;
}

export function pixelFrame(rect: { minX: number; minY: number; maxX: number; maxY: number }, metersPerPx: number): PixelFrame {
  return {
    minX: rect.minX,
    maxY: rect.maxY,
    metersPerPx,
    w: Math.ceil((rect.maxX - rect.minX) / metersPerPx),
    h: Math.ceil((rect.maxY - rect.minY) / metersPerPx),
  };
}

export function specToPixel(f: PixelFrame, x: number, y: number): { x: number; y: number } {
  return { x: (x - f.minX) / f.metersPerPx, y: (f.maxY - y) / f.metersPerPx };
}

/** Spec position of the centre of pixel (px, py). */
export function pixelToSpec(f: PixelFrame, px: number, py: number): { x: number; y: number } {
  return { x: f.minX + (px + 0.5) * f.metersPerPx, y: f.maxY - (py + 0.5) * f.metersPerPx };
}
