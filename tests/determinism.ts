/**
 * Memory-safe determinism helpers. Not a test file itself: imported by the real-area determinism
 * tests (and tested by tests/determinism.test.ts).
 *
 * Why: `assert.deepEqual` over a whole generated city renders a diff of two huge objects when it
 * fails, which once ate 2+ GB of RAM in seconds. Here equality is a streamed sha256 of a canonical
 * encoding, and a failure reports only the first differing path with bounded previews.
 *
 * The tests built on these rebuild the world, so they are opt-in: TRANSITO_DETERMINISM=1
 * (`npm run test:determinism`).
 */
import { AssertionError } from 'node:assert';
import { createHash } from 'node:crypto';
import type { Hash } from 'node:crypto';
import { test } from 'node:test';
import { inspect } from 'node:util';

/** Register a real-area determinism test; skipped unless TRANSITO_DETERMINISM=1. */
export function determinismTest(name: string, fn: () => void): void {
  const on = process.env.TRANSITO_DETERMINISM === '1';
  test(`determinism: ${name}`, { skip: on ? false : 'set TRANSITO_DETERMINISM=1 (npm run test:determinism)' }, fn);
}

// ---------- canonical streamed encoding ----------

const FLUSH_AT = 64 * 1024;

class Sink {
  private readonly hash: Hash = createHash('sha256');
  private readonly buf = Buffer.allocUnsafe(FLUSH_AT + 16);
  private n = 0;

  private flush(): void {
    if (this.n > 0) this.hash.update(this.buf.subarray(0, this.n));
    this.n = 0;
  }
  private room(k: number): void {
    if (this.n + k > FLUSH_AT) this.flush();
  }
  tag(t: number): void {
    this.room(1);
    this.buf[this.n++] = t;
  }
  u32(v: number): void {
    this.room(4);
    this.buf.writeUInt32LE(v >>> 0, this.n);
    this.n += 4;
  }
  f64(v: number): void {
    this.room(8);
    if (Number.isNaN(v)) this.buf.writeDoubleLE(NaN, this.n);
    else this.buf.writeDoubleLE(v, this.n); // keeps the sign bit of -0
    this.n += 8;
  }
  str(s: string): void {
    const len = Buffer.byteLength(s, 'utf8');
    this.u32(len);
    if (len <= FLUSH_AT) {
      this.room(len);
      this.n += this.buf.write(s, this.n, 'utf8');
    } else {
      this.flush();
      this.hash.update(s, 'utf8');
    }
  }
  bytes(b: Uint8Array): void {
    this.flush();
    this.hash.update(b);
  }
  hex(): string {
    this.flush();
    return this.hash.digest('hex');
  }
}

const T = { undef: 1, nul: 2, bool: 3, num: 4, str: 5, big: 6, arr: 7, typed: 8, map: 9, set: 10, date: 11, obj: 12 } as const;

const ctorName = (v: object): string => (v as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
const showPath = (p: string): string => (p === '' ? '(root)' : p);
const sortedKeys = (v: object): string[] => Object.keys(v).sort();
const keyPath = (p: string, k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? (p === '' ? k : `${p}.${k}`) : `${p}[${JSON.stringify(k)}]`);

function encode(v: unknown, path: string, sink: Sink, stack: Set<object>): void {
  switch (typeof v) {
    case 'undefined':
      return sink.tag(T.undef);
    case 'boolean':
      sink.tag(T.bool);
      return sink.tag(v ? 1 : 0);
    case 'number':
      sink.tag(T.num);
      return sink.f64(v);
    case 'string':
      sink.tag(T.str);
      return sink.str(v);
    case 'bigint':
      sink.tag(T.big);
      return sink.str(v.toString());
    case 'function':
      throw new TypeError(`digest: function at ${showPath(path)} (strip closures before comparing)`);
    case 'symbol':
      throw new TypeError(`digest: symbol at ${showPath(path)}`);
  }
  if (v === null) return sink.tag(T.nul);
  const o = v as object;
  if (stack.has(o)) throw new TypeError(`digest: cycle at ${showPath(path)}`);
  stack.add(o);
  try {
    if (Array.isArray(o)) {
      sink.tag(T.arr);
      sink.u32(o.length);
      for (let i = 0; i < o.length; i++) encode(o[i], `${path}[${i}]`, sink, stack);
    } else if (ArrayBuffer.isView(o)) {
      sink.tag(T.typed);
      sink.str(ctorName(o));
      sink.u32(o.byteLength);
      sink.bytes(new Uint8Array(o.buffer, o.byteOffset, o.byteLength));
    } else if (o instanceof ArrayBuffer) {
      sink.tag(T.typed);
      sink.str('ArrayBuffer');
      sink.u32(o.byteLength);
      sink.bytes(new Uint8Array(o));
    } else if (o instanceof Map) {
      sink.tag(T.map);
      sink.u32(o.size);
      let i = 0;
      for (const [k, val] of o) {
        encode(k, `${path}<key ${i}>`, sink, stack);
        encode(val, `${path}<value ${i}>`, sink, stack);
        i++;
      }
    } else if (o instanceof Set) {
      sink.tag(T.set);
      sink.u32(o.size);
      let i = 0;
      for (const val of o) encode(val, `${path}<item ${i++}>`, sink, stack);
    } else if (o instanceof Date) {
      sink.tag(T.date);
      sink.f64(o.getTime());
    } else {
      sink.tag(T.obj);
      sink.str(ctorName(o));
      const keys = sortedKeys(o);
      sink.u32(keys.length);
      for (const k of keys) {
        sink.str(k);
        encode((o as Record<string, unknown>)[k], keyPath(path, k), sink, stack);
      }
    }
  } finally {
    stack.delete(o);
  }
}

/** sha256 (hex) of a canonical, type-tagged encoding of `value`, streamed (never one big string). */
export function digest(value: unknown): string {
  const sink = new Sink();
  encode(value, '', sink, new Set());
  return sink.hex();
}

// ---------- first-difference walk ----------

interface Diff {
  path: string;
  a: unknown;
  b: unknown;
}

const MISSING = Symbol('missing');

function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v !== 'object') return typeof v;
  if (Array.isArray(v)) return 'array';
  if (ArrayBuffer.isView(v)) return `typed:${ctorName(v)}`;
  if (v instanceof ArrayBuffer) return 'typed:ArrayBuffer';
  if (v instanceof Map) return 'map';
  if (v instanceof Set) return 'set';
  if (v instanceof Date) return 'date';
  return `object:${ctorName(v)}`;
}

function firstDiff(a: unknown, b: unknown, path: string): Diff | null {
  const ka = kindOf(a);
  if (ka !== kindOf(b)) return { path, a, b };
  if (ka === 'null' || (typeof a !== 'object' && typeof a !== 'function')) return Object.is(a, b) ? null : { path, a, b };
  const x = a as object;
  const y = b as object;
  if (Array.isArray(x)) {
    const ya = y as unknown[];
    const n = Math.min(x.length, ya.length);
    for (let i = 0; i < n; i++) {
      const d = firstDiff(x[i], ya[i], `${path}[${i}]`);
      if (d) return d;
    }
    return x.length === ya.length ? null : { path: `${path}.length`, a: x.length, b: ya.length };
  }
  if (ka.startsWith('typed:')) {
    const ba = ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : new Uint8Array(x as ArrayBuffer);
    const bb = ArrayBuffer.isView(y) ? new Uint8Array(y.buffer, y.byteOffset, y.byteLength) : new Uint8Array(y as ArrayBuffer);
    if (ba.length !== bb.length) return { path: `${path}.byteLength`, a: ba.length, b: bb.length };
    const view = ArrayBuffer.isView(x) && !(x instanceof DataView);
    const size = view ? (x as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT : 1;
    for (let i = 0; i < ba.length; i++) {
      if (ba[i] !== bb[i]) {
        const idx = Math.floor(i / size);
        const ea = view ? (x as unknown as ArrayLike<unknown>)[idx] : ba[i];
        const eb = view ? (y as unknown as ArrayLike<unknown>)[idx] : bb[i];
        return { path: `${path}[${view ? idx : i}]`, a: ea, b: eb };
      }
    }
    return null;
  }
  if (x instanceof Map) {
    const my = y as Map<unknown, unknown>;
    if (x.size !== my.size) return { path: `${path}.size`, a: x.size, b: my.size };
    const ea = [...x];
    const eb = [...my];
    for (let i = 0; i < ea.length; i++) {
      const dk = firstDiff(ea[i]![0], eb[i]![0], `${path}<key ${i}>`);
      if (dk) return dk;
      const dv = firstDiff(ea[i]![1], eb[i]![1], `${path}<value ${i}>`);
      if (dv) return dv;
    }
    return null;
  }
  if (x instanceof Set) {
    const sy = y as Set<unknown>;
    if (x.size !== sy.size) return { path: `${path}.size`, a: x.size, b: sy.size };
    const ea = [...x];
    const eb = [...sy];
    for (let i = 0; i < ea.length; i++) {
      const d = firstDiff(ea[i], eb[i], `${path}<item ${i}>`);
      if (d) return d;
    }
    return null;
  }
  if (x instanceof Date) return Object.is(x.getTime(), (y as Date).getTime()) ? null : { path, a: x, b: y };
  const ra = x as Record<string, unknown>;
  const rb = y as Record<string, unknown>;
  const keysA = sortedKeys(x);
  const keysB = sortedKeys(y);
  const inB = new Set(keysB);
  const inA = new Set(keysA);
  for (const k of keysA) {
    if (!inB.has(k)) return { path: keyPath(path, k), a: ra[k], b: MISSING };
    const d = firstDiff(ra[k], rb[k], keyPath(path, k));
    if (d) return d;
  }
  for (const k of keysB) if (!inA.has(k)) return { path: keyPath(path, k), a: MISSING, b: rb[k] };
  return null;
}

function preview(v: unknown): string {
  if (v === MISSING) return '<missing>';
  const s = inspect(v, { depth: 0, maxArrayLength: 5, maxStringLength: 80, breakLength: Infinity });
  return s.length > 200 ? `${s.slice(0, 197)}...` : s;
}

/** Pass when both values encode identically; otherwise fail at the first differing path, with a bounded message. */
export function assertSameData(actual: unknown, expected: unknown, label: string): void {
  if (digest(actual) === digest(expected)) return;
  const d = firstDiff(actual, expected, '');
  const message = d
    ? `${label} differs at ${showPath(d.path)}: ${preview(d.a)} vs ${preview(d.b)}`
    : `${label} differs (digests differ but no path found)`;
  // No actual/expected properties: those are what make the runner render a giant diff.
  throw new AssertionError({ message, operator: 'assertSameData' });
}

/** Fail (bounded message) when both values encode identically. */
export function assertDifferentData(a: unknown, b: unknown, label: string): void {
  const da = digest(a);
  if (da !== digest(b)) return;
  throw new AssertionError({ message: `${label}: expected different data, got identical (digest ${da.slice(0, 12)})`, operator: 'assertDifferentData' });
}
