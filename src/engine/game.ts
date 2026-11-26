import { createEcs } from '../ecs/world.ts';
import { createServices } from '../ecs/services.ts';
import { orderPlugins } from '../ecs/schedule.ts';
import type { GameContext, GamePlugin, Phase, System } from '../ecs/plugin.ts';
import { createFrameGate } from '../sim/frame-gate.ts';
import { createPauseState } from '../ecs/pause.ts';
import { createPluginScopes, createScope } from '../ecs/scope.ts';
import { createInput } from './input.ts';
import { createPhysics } from './physics.ts';
import { createView } from './view.ts';

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 5;
const MAX_FRAME_DT = 0.1;

export interface Game {
  ctx: GameContext;
  stop(): void;
  /** Disposes every plugin's owned resources (reverse registration order). Idempotent. */
  disposePlugins(): void;
}

export async function createGame(opts: {
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  plugins: readonly GamePlugin[];
}): Promise<Game> {
  const { canvas, ui, plugins } = opts;
  const input = createInput(window);
  const physics = await createPhysics();
  const view = await createView(canvas);
  const scopes = createPluginScopes();
  const rootScope = createScope();
  // Teardown order: disposePlugins() runs scopes.disposeAll() (every plugin scope, so plugin cleanups that remove
  // rigid bodies run first) and only then rootScope.dispose(), which frees the Rapier World.
  rootScope.own(() => physics.free());
  const systems: Record<Phase, System[]> = { input: [], fixed: [], update: [], late: [], render: [] };
  const ctx: GameContext = {
    ecs: createEcs(),
    services: createServices(),
    input,
    physics,
    view,
    ui,
    pause: createPauseState(),
    addSystem: (s) => systems[s.phase].push(s),
    own: rootScope.own,
  };

  for (const plugin of orderPlugins(plugins)) {
    try {
      await plugin.setup({ ...ctx, own: scopes.forPlugin(plugin.name).own });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const box = document.createElement('pre');
      box.style.cssText = 'color:#f33;font:14px monospace;padding:12px;white-space:pre-wrap';
      box.textContent = `Plugin "${plugin.name}" failed: ${msg}`;
      ui.append(box);
      throw err;
    }
  }

  const gate = createFrameGate({ step: FIXED_STEP, maxSteps: MAX_STEPS, maxDt: MAX_FRAME_DT, startMs: performance.now() });
  let elapsed = 0;
  let frame = 0;
  const run = (phase: Phase, dt: number): void => {
    for (const s of systems[phase]) s.run(ctx, { dt, elapsed, frame });
  };

  view.renderer.setAnimationLoop((now: number) => {
    const paused = ctx.pause.paused;
    const { dt, steps } = gate.advance(now, paused);
    frame++;
    if (paused) {
      input.clear();
    } else {
      elapsed += dt;
      run('input', dt);
      for (let i = 0; i < steps; i++) {
        run('fixed', FIXED_STEP);
        physics.step(FIXED_STEP);
      }
      run('update', dt);
    }
    run('late', dt);
    run('render', dt);
    view.render();
  });

  const disposePlugins = (): void => {
    console.log(`[teardown] live owned: ${scopes.live + rootScope.live}`);
    try {
      scopes.disposeAll();
    } finally {
      rootScope.dispose();
      console.log(`[teardown] live owned: ${scopes.live + rootScope.live}`);
    }
  };

  return {
    ctx,
    disposePlugins,
    stop() {
      view.renderer.setAnimationLoop(null);
      try {
        disposePlugins();
      } finally {
        input.dispose();
        view.dispose();
      }
    },
  };
}
