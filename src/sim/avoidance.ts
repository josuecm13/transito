import type { Vec2 } from '../world/vec.ts';

/** Blocked if any other circle touches the corridor from p to p + heading * lookAhead. Behind is ignored. */
export function isBlocked(
  self: { p: Vec2; heading: Vec2; radius: number },
  others: readonly { p: Vec2; radius: number }[],
  lookAhead: number,
): boolean {
  for (const o of others) {
    const dx = o.p.x - self.p.x;
    const dy = o.p.y - self.p.y;
    const along = dx * self.heading.x + dy * self.heading.y;
    if (along < 0) continue;
    const a = Math.min(along, lookAhead);
    const px = dx - self.heading.x * a;
    const py = dy - self.heading.y * a;
    const reach = self.radius + o.radius;
    if (px * px + py * py < reach * reach) return true;
  }
  return false;
}
