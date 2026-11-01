import { createGame } from '../engine/game.ts';
import { worldData } from '../plugins/world-data.ts';
import { worldView } from '../plugins/world-view.ts';
import { worldPhysics } from '../plugins/world-physics.ts';
import { cameraFollow } from '../plugins/camera-follow.ts';
import { pedestrians } from '../plugins/pedestrians.ts';
import { debugHud } from '../plugins/debug-hud.ts';
import { WorldDataKey } from '../plugins/keys.ts';
import { sceneToSpec } from '../world/coords.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const readout = document.getElementById('peds-debug') as HTMLElement;

// No player: the population focus falls back to the spawn landmark.
const game = await createGame({
  canvas,
  ui,
  plugins: [worldData, worldView, worldPhysics, cameraFollow, pedestrians, debugHud],
});

const { spec, slice } = game.ctx.services.get(WorldDataKey);

// ?walk=1: a stand-in focus that drifts south along the avenue so near pedestrians (physics LOD) get exercised.
if (new URLSearchParams(location.search).has('walk')) {
  const f = game.ctx.ecs.add({
    position: { x: slice.spawn.position.x, y: 0, z: -slice.spawn.position.y },
    populationFocus: true as const,
    cameraTarget: true as const,
    obstacle: { radius: 0.4 },
  });
  game.ctx.addSystem({ name: 'lab-focus-walk', phase: 'fixed', run: (_c, { dt }) => (f.position.z += 3 * dt) });
}
const focus = game.ctx.ecs.with('populationFocus');
const peds = game.ctx.ecs.with('pedestrian', 'follower');
setInterval(() => {
  let physical = 0;
  let blocked = 0;
  let maxDist = 0;
  for (const e of peds) {
    if (e.body) physical++;
    if (e.follower.blocked) blocked++;
    const p = sceneToSpec(e.position);
    const f = focus.first ? sceneToSpec(focus.first.position) : slice.spawn.position;
    maxDist = Math.max(maxDist, Math.hypot(p.x - f.x, p.y - f.y));
  }
  const cfg = spec.population.pedestrians;
  readout.textContent =
    `alive ${peds.size} / budget ${cfg.budget}\nphysical ${physical}\nblocked ${blocked}\n` +
    `maxDist ${maxDist.toFixed(1)} / despawnAt ${cfg.despawnAt}`;
}, 500);
