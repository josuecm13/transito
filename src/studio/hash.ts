/** Small pure 53-bit string/number hash (cyrb53), so the core runs in Node and in the browser alike. */
export class Hasher {
  private h1 = 0xdeadbeef;
  private h2 = 0x41c6ce57;
  int(n: number): this {
    this.h1 = Math.imul(this.h1 ^ n, 2654435761);
    this.h2 = Math.imul(this.h2 ^ n, 1597334677);
    return this;
  }
  str(s: string): this {
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
    return this.int(0x1f);
  }
  /** Numbers quantised to 1e-3, so the hash is stable against float formatting but not against real change. */
  floats(a: ArrayLike<number>): this {
    for (let i = 0; i < a.length; i++) this.int(Math.round(a[i]! * 1000) | 0);
    return this.int(a.length);
  }
  hex(): string {
    const a = Math.imul(this.h1 ^ (this.h1 >>> 16), 2246822507) ^ Math.imul(this.h2 ^ (this.h2 >>> 13), 3266489909);
    const b = Math.imul(this.h2 ^ (this.h2 >>> 16), 2246822507) ^ Math.imul(this.h1 ^ (this.h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & b) + (a >>> 0)).toString(16).padStart(14, '0');
  }
}

/** JSON with sorted keys: the same value always serialises the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export const hashJson = (v: unknown): string => new Hasher().str(canonical(v)).hex();
