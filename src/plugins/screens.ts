import type { GamePlugin } from '../ecs/plugin.ts';
import { createScreens } from '../ui/screens.ts';
import { ScreensKey } from './keys.ts';

export const screens: GamePlugin = {
  name: 'screens',
  setup(ctx) {
    const { screens: service } = createScreens({ parent: ctx.ui, pause: ctx.pause, win: window });
    ctx.services.provide(ScreensKey, service);
  },
};
