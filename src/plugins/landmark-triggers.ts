import type { GamePlugin } from '../ecs/plugin.ts';
import { WorldDataKey } from './keys.ts';
import { specToScene } from '../world/coords.ts';
import { updateTrigger } from '../sim/triggers.ts';
import { createPrompt } from '../ui/prompt.ts';

const HYSTERESIS = 2;

export const landmarkTriggers: GamePlugin = {
  name: 'landmark-triggers',
  dependsOn: ['world-data', 'player'],
  setup(ctx) {
    const { slice } = ctx.services.get(WorldDataKey);
    const prompt = createPrompt(ctx.ui);

    for (const l of slice.landmarks) {
      if (l.triggerRadius === undefined) continue;
      ctx.ecs.add({
        position: specToScene(l.position),
        trigger: { radius: l.triggerRadius, label: l.displayName ?? l.id, inside: false },
      });
    }

    const triggers = ctx.ecs.with('trigger');
    const players = ctx.ecs.with('player');

    ctx.addSystem({
      name: 'landmark-triggers',
      phase: 'update',
      run() {
        const p = players.first;
        if (!p) return;
        for (const e of triggers) {
          const d = Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z);
          const r = updateTrigger(e.trigger.inside, d, e.trigger.radius, HYSTERESIS);
          e.trigger.inside = r.inside;
          if (r.event === 'enter') prompt.show(e.trigger.label);
          else if (r.event === 'exit') prompt.hide();
        }
      },
    });
  },
};
