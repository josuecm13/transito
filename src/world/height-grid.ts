/** A regular grid of heights (m) over the spec plane. */
export interface HeightGrid {
  /** Spec x / y of sample (0, 0), meters. */
  x0: number;
  y0: number;
  cell: number;
  /** Samples along x (east) and y (north). */
  cols: number;
  rows: number;
  /** data[j * cols + i] is the height at (x0 + i * cell, y0 + j * cell). */
  data: Float32Array;
}
