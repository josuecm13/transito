export interface FixedStep {
  /** Feed a frame dt; returns how many fixed steps to run. */
  advance(frameDt: number): number;
  /** Leftover fraction of a step, 0..1. */
  readonly alpha: number;
  /** Drop any accumulated time. */
  reset(): void;
}

export function createFixedStep(stepSeconds: number, maxStepsPerFrame: number): FixedStep {
  let acc = 0;
  return {
    reset() {
      acc = 0;
    },
    advance(frameDt) {
      acc += Math.max(0, frameDt);
      let steps = Math.floor(acc / stepSeconds + 1e-9);
      if (steps > maxStepsPerFrame) {
        steps = maxStepsPerFrame;
        acc = 0; // drop excess time (spiral-of-death guard)
      } else {
        acc = Math.max(0, acc - steps * stepSeconds);
      }
      return steps;
    },
    get alpha() {
      return acc / stepSeconds;
    },
  };
}
