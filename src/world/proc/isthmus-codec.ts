/**
 * Binary form of a generated `Isthmus` (#12 2.5, card F6): the game loads the isthmus baked at build
 * time instead of generating it on the main thread (~6 s). Pure, no Node or DOM APIs beyond
 * TextEncoder / TextDecoder, so the bake tool and the browser share it.
 *
 * Layout: "TIS1" | u32 header length (LE) | header (UTF-8 JSON) | zero padding to 8 | typed-array data,
 * each array 8-byte aligned. The header is `{ arrays: [type, byteOffset, length][], data }`, where
 * `data` is the isthmus with every typed array replaced by `{ $ta: index }`, and the values JSON can't
 * carry exactly tagged: `{ $num: "-0" | "NaN" | "Infinity" | "-Infinity" }`, `{ $u: 1 }` for undefined.
 * Decoding gives a value deep-equal to the input (shared references come back as equal copies).
 */
import type { Isthmus } from './isthmus.ts';

const MAGIC = [0x54, 0x49, 0x53, 0x31]; // "TIS1"

const TYPED = {
  Float64Array,
  Float32Array,
  Int32Array,
  Uint32Array,
  Int16Array,
  Uint16Array,
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
} as const;
type TypedName = keyof typeof TYPED;
type Typed = InstanceType<(typeof TYPED)[TypedName]>;

const isTyped = (v: unknown): v is Typed => ArrayBuffer.isView(v) && !(v instanceof DataView);

export function encodeIsthmus(iso: Isthmus): Uint8Array {
  const arrays: Typed[] = [];
  const tag = (v: unknown): unknown => {
    if (v === undefined) return { $u: 1 };
    if (typeof v === 'number') {
      if (Object.is(v, -0)) return { $num: '-0' };
      if (!Number.isFinite(v)) return { $num: String(v) };
      return v;
    }
    if (v === null || typeof v !== 'object') return v;
    if (isTyped(v)) {
      if (!(v.constructor.name in TYPED)) throw new Error(`isthmus-codec: unsupported ${v.constructor.name}`);
      arrays.push(v);
      return { $ta: arrays.length - 1 };
    }
    if (Array.isArray(v)) return v.map(tag);
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error(`isthmus-codec: unsupported ${proto?.constructor?.name ?? 'object'}`);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = tag((v as Record<string, unknown>)[k]);
    return out;
  };
  const data = tag(iso);

  const meta: [TypedName, number, number][] = [];
  let offset = 0;
  for (const a of arrays) {
    offset = Math.ceil(offset / 8) * 8;
    meta.push([a.constructor.name as TypedName, offset, a.length]);
    offset += a.byteLength;
  }
  const header = new TextEncoder().encode(JSON.stringify({ arrays: meta, data }));
  const dataStart = Math.ceil((8 + header.length) / 8) * 8;
  const out = new Uint8Array(dataStart + offset);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  arrays.forEach((a, i) => out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), dataStart + (meta[i] as [TypedName, number, number])[1]));
  return out;
}

export function decodeIsthmus(bytes: Uint8Array): Isthmus {
  if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('isthmus-codec: not an isthmus file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as { arrays: [TypedName, number, number][]; data: unknown };
  const dataStart = Math.ceil((8 + headerLen) / 8) * 8;
  // One aligned copy of the data block, so every view starts on its own 8-byte boundary.
  const block = bytes.slice(dataStart).buffer;
  const arrays = header.arrays.map(([type, off, n]) => {
    const Ctor = TYPED[type];
    if (!Ctor) throw new Error(`isthmus-codec: unknown array type ${type}`);
    return new Ctor(block, off, n);
  });
  const untag = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(untag);
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1) {
      if (keys[0] === '$ta') return arrays[o.$ta as number];
      if (keys[0] === '$num') return Number(o.$num);
      if (keys[0] === '$u') return undefined;
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = untag(o[k]);
    return out;
  };
  return untag(header.data) as Isthmus;
}
