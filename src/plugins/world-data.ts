import raw from '../../specs/map/world.yaml?raw';
import { isthmusUrl } from 'virtual:isthmus';
import type { GamePlugin } from '../ecs/plugin.ts';
import { decodeIsthmus } from '../world/proc/isthmus-codec.ts';
import { buildWorldData } from '../world/world-data.ts';
import { WorldDataKey } from './keys.ts';

export const worldData: GamePlugin = {
  name: 'world-data',
  async setup(ctx) {
    // The isthmus is baked at build time (tools/vite-isthmus.ts): fetched and decoded, not generated here.
    const t0 = performance.now();
    const res = await fetch(isthmusUrl);
    if (!res.ok) throw new Error(`world-data: baked isthmus ${isthmusUrl}: HTTP ${res.status}`);
    const isthmus = decodeIsthmus(new Uint8Array(await res.arrayBuffer()));
    const t1 = performance.now();
    const data = buildWorldData(raw, isthmus);
    const t2 = performance.now();
    ctx.services.provide(WorldDataKey, data);
    console.log(
      `[world-data] street edges=${data.streets.graph.edges.length} blocks=${data.streets.blocks.length} ` +
        `buildings=${data.buildings.length} walkGraph nodes=${data.walkGraph.nodes.length} ` +
        `edges=${data.walkGraph.edges.length} isthmus loaded in ${(t1 - t0).toFixed(0)} ms, generated in ${(t2 - t1).toFixed(0)} ms`,
    );
  },
};
