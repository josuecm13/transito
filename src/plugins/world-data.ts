import raw from '../../specs/map/world.yaml?raw';
import type { GamePlugin } from '../ecs/plugin.ts';
import { buildWorldData } from '../world/world-data.ts';
import { WorldDataKey } from './keys.ts';

export const worldData: GamePlugin = {
  name: 'world-data',
  setup(ctx) {
    const t0 = performance.now();
    const data = buildWorldData(raw);
    const ms = performance.now() - t0;
    ctx.services.provide(WorldDataKey, data);
    console.log(
      `[world-data] buildings=${data.buildings.length} walkGraph nodes=${data.walkGraph.nodes.length} ` +
        `edges=${data.walkGraph.edges.length} generated in ${ms.toFixed(0)} ms`,
    );
  },
};
