import type { WorldSpec } from '../spec.ts';
import type { Layer1Output } from './layer1-land-cover.ts';
import type { Layer2Output } from './layer2-relief.ts';
import type { Layer3Output } from './layer3-water.ts';

export interface Layer4Inputs {
  readonly layer1: Layer1Output;
  readonly layer2: Layer2Output;
  readonly layer3: Layer3Output;
}

/** Layer 4 output (skeleton: no taxiways or site levelling yet, issue I3). */
export interface Layer4Output {
  readonly layer: 4;
  readonly generated: false;
  readonly airportIds: readonly string[];
}

/** Layer 4: airports. Reads the spec and layers 1-3. Pure. */
export function layer4Airports(spec: WorldSpec, inputs: Layer4Inputs): Layer4Output {
  void inputs.layer1;
  void inputs.layer2;
  void inputs.layer3;
  return { layer: 4, generated: false, airportIds: spec.airports.map((a) => a.id) };
}
