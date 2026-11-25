/**
 * Saved Map Studio edits: specs/map/procedural-edits.json, a versioned, sorted list of path/value changes to
 * world.yaml's `procedural:` section. World.yaml keeps its comments; tools resolve the two together here.
 */
import type { WorldSpec } from '../world/spec.ts';
import type { Json } from './paths.ts';
import { applyEdits, build, openBase, type Change, type Edits } from './session.ts';

export const EDITS_FILE = 'specs/map/procedural-edits.json';

export function parseEdits(text: string): Edits {
  const o = JSON.parse(text) as { version?: number; edits?: Change[] };
  if (o.version !== 1 || !Array.isArray(o.edits)) throw new Error(`${EDITS_FILE}: expected {"version":1,"edits":[…]}`);
  return o.edits.map((e) => ({ path: String(e.path), value: e.value as Json }));
}

export function serialiseEdits(edits: Edits): string {
  return `${JSON.stringify({ version: 1, edits }, null, 2)}\n`;
}

/** world.yaml + saved edits → the WorldSpec every map tool should use. Throws with the parser's problems. */
export function parseWorldWithEdits(yaml: string, editsJson?: string): WorldSpec {
  const base = openBase(yaml);
  const r = applyEdits(base, editsJson ? parseEdits(editsJson) : []);
  if (r.problems.length) throw new Error(`${EDITS_FILE}: ${r.problems.join('; ')}`);
  const b = build(base, r.proc);
  if (!b.spec) throw new Error(`Invalid world spec:\n- ${b.problems.join('\n- ')}`);
  return b.spec;
}
