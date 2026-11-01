import { createFixedStep } from './fixed-step.ts';

export interface FrameGate {
  /**
   * Feed the frame timestamp (ms). `dt` is the clamped real frame time (0 on the first frame after a pause; real frame time while paused).
   * `steps` is the number of fixed steps to run (always 0 while paused).
   */
  advance(nowMs: number, paused: boolean): { dt: number; steps: number };
}

/** Frame clock + fixed-step accumulator with no catch-up burst after a pause. */
export function createFrameGate(opts: { step: number; maxSteps: number; maxDt: number; startMs: number }): FrameGate {
  const stepper = createFixedStep(opts.step, opts.maxSteps);
  let last = opts.startMs;
  let wasPaused = false;
  return {
    advance(nowMs, paused) {
      const real = Math.min(Math.max(0, (nowMs - last) / 1000), opts.maxDt);
      last = nowMs;
      if (paused) {
        stepper.reset();
        wasPaused = true;
        return { dt: real, steps: 0 };
      }
      if (wasPaused) {
        // paused -> running transition: restart accumulator, skip the stale frame time
        stepper.reset();
        wasPaused = false;
        return { dt: 0, steps: 0 };
      }
      return { dt: real, steps: stepper.advance(real) };
    },
  };
}
