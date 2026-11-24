export interface Input {
  isDown(code: string): boolean;
  /** x = right, y = forward (up-screen); diagonals normalized. */
  moveAxis(): { x: number; y: number };
  /** Mouse movement (px) since the last call, only while the pointer is locked; resets to zero. */
  takeMouseDelta(): { x: number; y: number };
  /** Forget all held keys and any pending mouse movement. */
  clear(): void;
  dispose(): void;
}

export function createInput(target: Window): Input {
  const down = new Set<string>();
  const onDown = (e: KeyboardEvent): void => {
    down.add(e.code);
  };
  const onUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
  };
  let mx = 0;
  let my = 0;
  const onMove = (e: MouseEvent): void => {
    if (!target.document.pointerLockElement) return;
    mx += e.movementX;
    my += e.movementY;
  };
  const clear = (): void => {
    down.clear();
    mx = 0;
    my = 0;
  };
  target.addEventListener('mousemove', onMove);
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', clear);
  target.document.addEventListener('visibilitychange', clear);
  const any = (...codes: string[]): boolean => codes.some((c) => down.has(c));
  return {
    isDown: (code) => down.has(code),
    clear,
    takeMouseDelta() {
      const d = { x: mx, y: my };
      mx = 0;
      my = 0;
      return d;
    },
    moveAxis() {
      const x = (any('KeyD', 'ArrowRight') ? 1 : 0) - (any('KeyA', 'ArrowLeft') ? 1 : 0);
      const y = (any('KeyW', 'ArrowUp') ? 1 : 0) - (any('KeyS', 'ArrowDown') ? 1 : 0);
      const len = Math.hypot(x, y);
      return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
    },
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('mousemove', onMove);
      target.removeEventListener('blur', clear);
      target.document.removeEventListener('visibilitychange', clear);
      clear();
    },
  };
}
