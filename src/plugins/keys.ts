import { createServiceKey } from '../ecs/services.ts';
import type { WorldData } from '../world/world-data.ts';
import type { Screens } from '../ui/screens.ts';
import type { Layer1Output } from '../world/layers/layer1-land-cover.ts';

/** Shared service keys. Neutral module: plugins import keys from here, never from each other. */
export const WorldDataKey = createServiceKey<WorldData>('world-data');
/** Modal screen stack, menu entries and shortcuts. */
export const ScreensKey = createServiceKey<Screens>('screens');

/** Layer 1 (land cover), computed once by world-view and shared with the map screens. */
export const LandCoverKey = createServiceKey<Layer1Output>('land-cover');
