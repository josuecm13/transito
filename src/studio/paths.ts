/**
 * Paths into the `procedural:` mapping: `procedural.lake.target_km2`, `procedural.relief.zones[1].width`,
 * or by id (stable across reordering): `procedural.towns.items[id=el-corredor].target_km2`.
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Seg = { key: string } | { index: number } | { id: string };

export function parsePath(path: string): Seg[] {
  if (!/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*|\[\d+\]|\[id=[\w-]+\])*$/.test(path)) throw new Error(`bad path '${path}'`);
  const segs: Seg[] = [];
  for (const m of path.matchAll(/\[(\d+)\]|\[id=([\w-]+)\]|([A-Za-z_][\w-]*)/g)) {
    if (m[3] !== undefined) segs.push({ key: m[3] });
    else if (m[1] !== undefined) segs.push({ index: Number(m[1]) });
    else segs.push({ id: m[2]! });
  }
  return segs;
}

const isObj = (v: unknown): v is { [k: string]: Json } => !!v && typeof v === 'object' && !Array.isArray(v);

function step(node: Json | undefined, s: Seg, path: string): { parent: Json; key: string | number } {
  if ('key' in s) {
    if (!isObj(node)) throw new Error(`${path}: '${s.key}' is not under a mapping`);
    return { parent: node, key: s.key };
  }
  if (!Array.isArray(node)) throw new Error(`${path}: expected a list`);
  if ('index' in s) return { parent: node, key: s.index };
  const k = node.findIndex((e) => isObj(e) && e.id === s.id);
  if (k < 0) throw new Error(`${path}: no entry with id '${s.id}'`);
  return { parent: node, key: k };
}

const read = (p: { parent: Json; key: string | number }): Json | undefined =>
  Array.isArray(p.parent) ? p.parent[p.key as number] : (p.parent as { [k: string]: Json })[p.key as string];

export function getAt(root: Json, path: string): Json | undefined {
  let node: Json | undefined = root;
  for (const s of parsePath(path)) {
    if (node === undefined) return undefined;
    try {
      node = read(step(node, s, path));
    } catch {
      return undefined;
    }
  }
  return node;
}

/** Sets `path` in place; the key must already exist (an edit never invents a parameter). */
export function setAt(root: Json, path: string, value: Json): void {
  const segs = parsePath(path);
  let node: Json = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const next = read(step(node, segs[i]!, path));
    if (next === undefined) throw new Error(`${path}: no such parameter`);
    node = next;
  }
  const last = step(node, segs[segs.length - 1]!, path);
  if (read(last) === undefined) throw new Error(`${path}: no such parameter`);
  if (Array.isArray(last.parent)) last.parent[last.key as number] = value;
  else (last.parent as { [k: string]: Json })[last.key as string] = value;
}

export const clone = <T extends Json>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
