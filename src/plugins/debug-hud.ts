import type { GamePlugin } from '../ecs/plugin.ts';
import { sceneToSpec } from '../world/coords.ts';
import { DebugModeKey } from './keys.ts';

export const debugHud: GamePlugin = {
  name: 'debug-hud',
  dependsOn: ['debug-mode'],
  setup(ctx) {
    const debug = ctx.services.get(DebugModeKey);
    const box = document.createElement('div');
    box.style.cssText =
      'position:absolute;top:8px;left:8px;padding:4px 8px;background:rgba(0,0,0,.55);' +
      'color:#fff;font:12px monospace;white-space:pre;pointer-events:none';
    ctx.ui.append(box);

    const players = ctx.ecs.with('player');
    const peds = ctx.ecs.with('pedestrian');
    const debugLines = (): string => {
      const d = debug.info;
      if (!d) return '';
      return (
        `\n-- DEBUG --\nCámara x ${d.x.toFixed(0)}  y ${d.y.toFixed(0)}\nAltura ${d.height.toFixed(0)} m  Suelo ${d.ground.toFixed(0)} m` +
        `\nCobertura ${d.cover}\nVelocidad ${d.speed.toFixed(0)} m/s`
      );
    };
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
          `\nTito ${tito}\nPeatones ${peds.size}` + (c.pause.paused ? '\nPAUSA' : '') + debugLines();
      },
    });
  },
};
