import type { WorldSpec } from '../spec.ts';
import type { HeightGrid } from '../terrain.ts';
import { Terrain } from '../terrain.ts';
import type { Layer1Output } from './layer1-land-cover.ts';

export interface Layer2Inputs {
  /** Not needed numerically; optional so callers that skip layer 1 stay cheap. */
  readonly layer1?: Layer1Output;
}

/**
 * Layer 2 output: the base height H0 (before rivers, canal, airports and street grading), baked on
 * two grids with the same origin (0, 0): the whole isthmus on the far grid, and the active rect plus
 * margin on the fine grid. Rivers / canal / airports (layers 3-4) carve H0 later.
 */
export interface Layer2Output {
  readonly layer: 2;
  readonly generated: true;
  readonly seed: number;
  readonly ridgeIds: readonly string[];
  readonly cellFar: number;
  readonly cellFine: number;
  /** H0 on the whole isthmus, `cellFar` m between nodes. */
  readonly far: HeightGrid;
  /** H0 on the active rect + margin, `cellFine` m between nodes. */
  readonly fine: HeightGrid;
}

/** Layer 2: relief (base height H0). Reads the spec; layer 1 is not needed numerically. Pure. */
export function layer2Relief(spec: WorldSpec, inputs: Layer2Inputs): Layer2Output {
  void inputs.layer1;
  const a = spec.activeArea;
  const terrain = new Terrain(spec, { minX: a.x[0], maxX: a.x[1], minY: a.y[0], maxY: a.y[1] });
  return {
    layer: 2,
    generated: true,
    seed: spec.relief.seed,
    ridgeIds: spec.relief.ridges.map((r) => r.id),
    cellFar: spec.relief.grid.far.cell,
    cellFine: spec.relief.grid.cell,
    far: terrain.farGrid,
    fine: terrain.baseGrid,
  };
}
