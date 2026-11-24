import type { WorldSpec } from '../spec.ts';
import { layer1LandCover } from './layer1-land-cover.ts';
import type { Layer1Output } from './layer1-land-cover.ts';
import { layer2Relief } from './layer2-relief.ts';
import type { Layer2Output } from './layer2-relief.ts';
import { layer3Water } from './layer3-water.ts';
import type { Layer3Output } from './layer3-water.ts';
import { layer4Airports } from './layer4-airports.ts';
import type { Layer4Output } from './layer4-airports.ts';
import { layer5MainRoads } from './layer5-main-roads.ts';
import type { Layer5Output } from './layer5-main-roads.ts';

export type { Layer1Output, Layer2Output, Layer3Output, Layer4Output, Layer5Output };
export { layer1LandCover, layer2Relief, layer3Water, layer4Airports, layer5MainRoads };

export interface MapLayers {
  readonly layer1: Layer1Output;
  readonly layer2: Layer2Output;
  readonly layer3: Layer3Output;
  readonly layer4: Layer4Output;
  readonly layer5: Layer5Output;
}

/** Runs layers 1-5 in order; layer N receives only the outputs of layers < N. */
export function runLayers(spec: WorldSpec): MapLayers {
  const layer1 = layer1LandCover(spec);
  const layer2 = layer2Relief(spec, { layer1 });
  const layer3 = layer3Water(spec, { layer1, layer2 });
  const layer4 = layer4Airports(spec, { layer1, layer2, layer3 });
  const layer5 = layer5MainRoads(spec, { layer1, layer2, layer3, layer4 });
  return { layer1, layer2, layer3, layer4, layer5 };
}
