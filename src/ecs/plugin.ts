import type { Ecs } from './world.ts';
import type { Services } from './services.ts';
import type { Input } from '../engine/input.ts';
import type { Physics } from '../engine/physics.ts';
import type { View } from '../engine/view.ts';
import type { PauseState } from './pause.ts';
import type { Scope } from './scope.ts';

export type Phase = 'input' | 'fixed' | 'update' | 'late' | 'render';

/** dt = fixed step in 'fixed', frame dt otherwise. */
export interface FrameInfo {
  dt: number;
  elapsed: number;
  frame: number;
}

export interface System {
  name: string;
  phase: Phase;
  run(ctx: GameContext, frame: FrameInfo): void;
}

export interface GamePlugin {
  name: string;
  dependsOn?: readonly string[];
  setup(ctx: GameContext): void | Promise<void>;
}

export interface GameContext {
  ecs: Ecs;
  services: Services;
  input: Input;
  physics: Physics;
  view: View;
  ui: HTMLElement;
  /** Pause reasons; while paused the engine skips input/fixed/physics/update. */
  pause: PauseState;
  /** Plugins register systems during setup. */
  addSystem(system: System): void;
  /**
   * Teardown: owns a disposable (or cleanup function) and returns it. During `setup` it is backed by that
   * plugin's own Scope; `game.stop()` / `game.disposePlugins()` dispose every plugin scope in reverse
   * registration order. Plugins that never call it behave as before.
   */
  own: Scope['own'];
}
