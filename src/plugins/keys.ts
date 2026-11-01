import { createServiceKey } from '../ecs/services.ts';
import type { WorldData } from '../world/world-data.ts';
import type { Screens } from '../ui/screens.ts';

/** Shared service keys. Neutral module: plugins import keys from here, never from each other. */
export const WorldDataKey = createServiceKey<WorldData>('world-data');
/** Modal screen stack, menu entries and shortcuts. */
export const ScreensKey = createServiceKey<Screens>('screens');
