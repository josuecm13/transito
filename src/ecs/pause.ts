export interface PauseState {
  /** Idempotent per reason. */
  pause(reason: string): void;
  resume(reason: string): void;
  /** True while at least one reason is held. */
  readonly paused: boolean;
  reasons(): string[];
}

export function createPauseState(): PauseState {
  const held = new Set<string>();
  return {
    pause: (reason) => void held.add(reason),
    resume: (reason) => void held.delete(reason),
    get paused() {
      return held.size > 0;
    },
    reasons: () => [...held],
  };
}
