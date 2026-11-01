export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, maxInclusive]. */
  int(min: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  /** Independent deterministic stream derived from this seed and a label. */
  fork(label: string): Rng;
}

function hashString(s: string): number {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 */
export function createRng(seed: number): Rng {
  const base = seed >>> 0;
  let a = base;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick from empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
    // Derived from the original seed (not current state) so forks do not depend on draw order.
    fork: (label) => createRng((base ^ Math.imul(hashString(label), 0x9e3779b1)) >>> 0),
  };
  return rng;
}
