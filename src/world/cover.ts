/**
 * Land cover of the whole isthmus on the far grid (origin (0, 0)), in the game's classes: built from the
 * procedural map (`coverFromIsthmus`, proc/game-world.ts). Cell (i, j) covers
 * [i * cell, (i + 1) * cell) x [j * cell, (j + 1) * cell). Plain data (typed arrays).
 */
export interface LandCover {
  /** Class names; `cover` holds indices into this list. */
  readonly classes: readonly string[];
  /** Cover grid cell, m (the far grid, relief.grid.far.cell). */
  readonly cellFar: number;
  readonly cols: number;
  readonly rows: number;
  /** cover[j * cols + i] = class index of cell (i, j). */
  readonly cover: Uint8Array;
  /** density[j * cols + i] = forest density f (0-1) as 0-255. */
  readonly density: Uint8Array;
}

/** Read-time query: class name at spec (x, y) (water outside the map). */
export function coverAt(layer: LandCover, x: number, y: number): string {
  const i = Math.floor(x / layer.cellFar);
  const j = Math.floor(y / layer.cellFar);
  if (i < 0 || j < 0 || i >= layer.cols || j >= layer.rows) return 'water';
  return layer.classes[layer.cover[j * layer.cols + i] as number] as string;
}

/** Read-time query: forest density 0-1 at spec (x, y) (0 outside the map). */
export function densityAt(layer: LandCover, x: number, y: number): number {
  const i = Math.floor(x / layer.cellFar);
  const j = Math.floor(y / layer.cellFar);
  if (i < 0 || j < 0 || i >= layer.cols || j >= layer.rows) return 0;
  return (layer.density[j * layer.cols + i] as number) / 255;
}
