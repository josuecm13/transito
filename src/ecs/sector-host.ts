import { createScope } from './scope.ts';
import type { Scope } from './scope.ts';

/** One named piece of a sector's content. Everything it creates must be handed to `own` so unload can free it. */
export interface SectorStep {
  name: string;
  build(own: Scope['own']): void;
}

export type SectorState = 'resident' | 'unloaded';

/**
 * A sector's lifecycle (doc 12, 3.1): build its content, free it, rebuild it. Each build gets a FRESH Scope;
 * unload disposes that Scope (reverse order, aggregated errors, idempotent). Pure: no DOM, window or three.
 */
export interface SectorHost {
  readonly state: SectorState;
  /** Number of successful builds. */
  readonly generation: number;
  /** Items owned by the current build and not yet disposed (0 while unloaded). */
  readonly live: number;
  /** Builds every step into a fresh Scope. Throws if already resident. A throwing step rolls the whole build back and rethrows. */
  build(): void;
  /** Disposes the current build. No-op when unloaded. */
  unload(): void;
  /** unload() then build(). */
  reload(): void;
  /**
   * Registers a step. While resident it runs into the live Scope at once (a plugin joining a built sector);
   * the very first step added to a never-built host builds the sector.
   */
  add(step: SectorStep): void;
}

export function createSectorHost(opts: { steps?: readonly SectorStep[] } = {}): SectorHost {
  const steps: SectorStep[] = [...(opts.steps ?? [])];
  let scope: Scope | undefined;
  let state: SectorState = 'unloaded';
  let generation = 0;

  /** Disposes `s`; when `cause` is given, a disposal failure is reported together with it. */
  const rollback = (s: Scope, cause: unknown): never => {
    try {
      s.dispose();
    } catch (err) {
      throw new AggregateError([cause, ...(err instanceof AggregateError ? err.errors : [err])], 'sector build failed and rollback failed');
    }
    throw cause;
  };

  const host: SectorHost = {
    get state() {
      return state;
    },
    get generation() {
      return generation;
    },
    get live() {
      return scope?.live ?? 0;
    },
    build() {
      if (state === 'resident') throw new Error('sector is already resident; unload() or reload() first');
      const s = createScope();
      try {
        for (const step of steps) step.build(s.own);
      } catch (err) {
        rollback(s, err);
      }
      scope = s;
      state = 'resident';
      generation++;
    },
    unload() {
      if (state === 'unloaded') return;
      const s = scope as Scope;
      scope = undefined;
      state = 'unloaded';
      s.dispose();
    },
    reload() {
      host.unload();
      host.build();
    },
    add(step) {
      steps.push(step);
      if (state === 'resident') {
        try {
          step.build((scope as Scope).own);
        } catch (err) {
          const s = scope as Scope;
          scope = undefined;
          state = 'unloaded';
          rollback(s, err);
        }
      } else if (generation === 0) {
        host.build();
      }
    },
  };
  return host;
}

/** The one-line reload report (doc 12, card 8). Missing numbers print as "n/a". */
export function formatReloadLine(
  generation: number,
  s: { children: number; geometries?: number; colliders?: number; heapMb?: number },
): string {
  const n = (v: number | undefined): string => (v === undefined ? 'n/a' : String(v));
  return `[sector] act1 reload #${generation}: scene children=${s.children}, geometries=${n(s.geometries)}, colliders=${n(s.colliders)}, JS heap MB=${n(s.heapMb)}`;
}
