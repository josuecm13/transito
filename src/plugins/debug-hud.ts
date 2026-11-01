import type { GamePlugin } from '../ecs/plugin.ts';
import { sceneToSpec } from '../world/coords.ts';

export const debugHud: GamePlugin = {
  name: 'debug-hud',
  setup(ctx) {
    const box = document.createElement('div');
    box.style.cssText =
      'position:absolute;top:8px;left:8px;padding:4px 8px;background:rgba(0,0,0,.55);' +
      'color:#fff;font:12px monospace;white-space:pre;pointer-events:none';
    ctx.ui.append(box);

    const players = ctx.ecs.with('player');
    const peds = ctx.ecs.with('pedestrian');
    let fps = 60;
    let sinceUpdate = 0;
    ctx.addSystem({
      name: 'debug-hud',
      phase: 'render',
      run(c, { dt }) {
        if (dt > 0) fps += (1 / dt - fps) * 0.1;
        sinceUpdate += dt;
        if (sinceUpdate < 0.5) return;
        sinceUpdate = 0;
        const p = players.first;
        const at = p ? sceneToSpec(p.position) : undefined;
        const tito = at ? `${at.x.toFixed(1)},${at.y.toFixed(1)}` : '-';
        // Previous frame's stats: this system runs before view.render() resets them.
        const r = c.view.renderer.info.render;
        box.textContent =
          `FPS ${fps.toFixed(0)}\nDraws ${r.drawCalls} Tris ${(r.triangles / 1000).toFixed(1)}k\nEntities ${c.ecs.entities.length}\nBackend ${c.view.backend}` +
          `\nTito ${tito}\nPeatones ${peds.size}` + (c.pause.paused ? '\nPAUSA' : '');
      },
    });
  },
};
