import type { WorldSpec } from '../spec.ts';
import type { Layer1Output } from './layer1-land-cover.ts';
import type { Layer2Output } from './layer2-relief.ts';
import type { Layer3Output } from './layer3-water.ts';
import type { Layer4Output } from './layer4-airports.ts';

export interface Layer5Inputs {
  readonly layer1: Layer1Output;
  readonly layer2: Layer2Output;
  readonly layer3: Layer3Output;
  readonly layer4: Layer4Output;
}

/** Layer 5 output (skeleton: no routed centrelines or bridges yet, issue I3). */
export interface Layer5Output {
  readonly layer: 5;
  readonly generated: false;
  readonly roadIds: readonly string[];
}

/** Layer 5: main roads. Reads the spec and layers 1-4. Pure. */
export function layer5MainRoads(spec: WorldSpec, inputs: Layer5Inputs): Layer5Output {
  void inputs.layer1;
  void inputs.layer2;
  void inputs.layer3;
  void inputs.layer4;
  return { layer: 5, generated: false, roadIds: spec.mainRoads.roads.map((r) => r.id) };
}
