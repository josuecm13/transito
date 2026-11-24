import type { LandCoverSpec, WorldSpec } from '../spec.ts';
import { pointInPolygon } from '../geometry.ts';
import { fbm } from '../terrain.ts';
import type { Vec2 } from '../vec.ts';

/**
 * Layer 1 output: the land-cover prior of the whole isthmus on the far grid (`relief.grid.far.cell`,
 * origin (0, 0)). Cell (i, j) covers [i * cell, (i + 1) * cell) x [j * cell, (j + 1) * cell) and is
 * classified at its centre. Plain data (typed arrays), so it compares and serialises like any other.
 */
export interface Layer1Output {
  readonly layer: 1;
  readonly generated: true;
  readonly seed: number;
  /** Class names, in spec order; `cover` holds indices into this list. */
  readonly classes: readonly string[];
  /** Cover grid cell, m (relief.grid.far.cell). */
  readonly cellFar: number;
  readonly cols: number;
  readonly rows: number;
  /** cover[j * cols + i] = class index of cell (i, j). */
  readonly cover: Uint8Array;
  /** density[j * cols + i] = forest density f (0-1) as 0-255, before the class thresholds. */
  readonly density: Uint8Array;
}

/** Forest density gain of the noise (noise is roughly +-0.3 one sigma, so f0 +- 0.3). */
const NOISE_GAIN = 1;
/** Density lost right on the shore, recovered over COAST_FADE m inland (thin coastal forest). */
const COAST_THIN = 0.15;
const COAST_FADE = 400;
/** Density band just above the clearing threshold that reads as grass (open ground), not forest. */
const GRASS_BAND = 0.1;

function segDist(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Shore edges of geometry.land: everything but the map's west / east / north bounds edges. */
export function shoreEdges(spec: WorldSpec): [Vec2, Vec2][] {
  const { width, height } = spec.bounds;
  const edges: [Vec2, Vec2][] = [];
  for (let i = 0; i < spec.land.length; i++) {
    const a = spec.land[i] as Vec2;
    const b = spec.land[(i + 1) % spec.land.length] as Vec2;
    if ((a.x === b.x && (a.x === 0 || a.x === width)) || (a.y === b.y && (a.y === 0 || a.y === height))) continue;
    edges.push([a, b]);
  }
  return edges;
}

/** Layer 1: land cover. Reads the spec only. Pure: no I/O, no clock, no randomness. */
export function layer1LandCover(spec: WorldSpec): Layer1Output {
  const lc: LandCoverSpec = spec.landCover;
  const cell = spec.relief.grid.far.cell;
  const cols = Math.round(spec.bounds.width / cell);
  const rows = Math.round(spec.bounds.height / cell);
  const idx = (name: string): number => {
    const k = lc.classes.indexOf(name);
    if (k < 0) throw new Error(`land_cover.classes: missing "${name}"`);
    return k;
  };
  const [WATER, MANGROVE, FOREST, CLEARING, GRASS, URBAN, PARK] = ['water', 'mangrove', 'forest', 'clearing', 'grass', 'urban_prior', 'park_reclaimed'].map(idx) as [number, number, number, number, number, number, number];

  const edges = shoreEdges(spec);
  const mangroveRects = lc.mangrove.shores.flatMap((id) => lc.tidalShores.filter((t) => t.id === id).map((t) => t.rect));
  // Reclaimed land: flatten zones that cap the terrain (Costa del Este).
  const reclaimed = spec.relief.flatten.filter((z) => z.cap !== undefined).map((z) => z.rect);
  const noise = { amplitude: NOISE_GAIN, ...lc.forest.noise };

  const cover = new Uint8Array(cols * rows);
  const density = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cell;
      const y = (j + 0.5) * cell;
      const k = j * cols + i;
      if (!pointInPolygon({ x, y }, spec.land)) {
        cover[k] = WATER;
        continue;
      }
      let d = Infinity;
      for (const [a, b] of edges) d = Math.min(d, segDist(x, y, a, b));
      const f = Math.min(1, Math.max(0, lc.forest.density + fbm(x, y, noise, lc.seed) - COAST_THIN * (1 - smoothstep(0, COAST_FADE, d))));
      density[k] = Math.round(f * 255);
      const inRect = (r: { minX: number; minY: number; maxX: number; maxY: number }): boolean => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
      if (d <= lc.mangrove.band && mangroveRects.some(inRect)) cover[k] = MANGROVE;
      else if (lc.settlements.some((s) => Math.hypot(x - s.at.x, y - s.at.y) <= s.radius)) cover[k] = URBAN;
      else if (reclaimed.some(inRect)) cover[k] = PARK;
      else if (f < lc.forest.clearingBelow) cover[k] = CLEARING;
      else if (f < lc.forest.clearingBelow + GRASS_BAND) cover[k] = GRASS;
      else cover[k] = FOREST;
    }
  }
  return { layer: 1, generated: true, seed: lc.seed, classes: lc.classes, cellFar: cell, cols, rows, cover, density };
}

/** Read-time query: class name at spec (x, y) (water outside the map). */
export function coverAt(layer: Layer1Output, x: number, y: number): string {
  const i = Math.floor(x / layer.cellFar);
  const j = Math.floor(y / layer.cellFar);
  if (i < 0 || j < 0 || i >= layer.cols || j >= layer.rows) return 'water';
  return layer.classes[layer.cover[j * layer.cols + i] as number] as string;
}

/** Read-time query: forest density 0-1 at spec (x, y) (0 outside the map). */
export function densityAt(layer: Layer1Output, x: number, y: number): number {
  const i = Math.floor(x / layer.cellFar);
  const j = Math.floor(y / layer.cellFar);
  if (i < 0 || j < 0 || i >= layer.cols || j >= layer.rows) return 0;
  return (layer.density[j * layer.cols + i] as number) / 255;
}
