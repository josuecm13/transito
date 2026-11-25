/**
 * A studio session = the authored world.yaml plus a list of edits to its `procedural:` mapping.
 * Pure (no fs): callers pass the YAML text and the saved edits.
 */
import { dump, load } from 'js-yaml';
import { parseWorldSpec, WorldSpecError, type ProceduralSpec, type WorldSpec } from '../world/spec.ts';
import { hashJson } from './hash.ts';
import { clone, getAt, setAt, type Json } from './paths.ts';
import { rangeProblems } from './params.ts';

export interface Change {
  readonly path: string;
  readonly value: Json;
}

/** Edit list of a map: only differences from world.yaml, sorted by path, last write wins. */
export type Edits = readonly Change[];

export interface Base {
  /** The world.yaml document (everything except `procedural`, which is edited). */
  readonly doc: { [k: string]: Json };
  /** The `procedural:` mapping as authored. */
  readonly proc: Json;
}

export function openBase(yaml: string): Base {
  const doc = load(yaml) as { [k: string]: Json };
  if (!doc || typeof doc !== 'object' || !doc.procedural) throw new Error('world.yaml has no `procedural:` section');
  return { doc, proc: doc.procedural };
}

export interface Resolved {
  readonly proc: Json;
  readonly problems: readonly string[];
}

/** Applies edits to the authored mapping. Problems are collected, never thrown: a bad path or value is reported. */
export function applyEdits(base: Base, edits: Edits): Resolved {
  const proc = clone(base.proc);
  const problems: string[] = [];
  for (const e of edits) {
    if (!e.path.startsWith('procedural.')) {
      problems.push(`${e.path}: only paths under 'procedural.' are editable`);
      continue;
    }
    try {
      const rel = e.path.slice('procedural.'.length);
      problems.push(...rangeProblems(e.path, e.value));
      setAt(proc, rel, clone(e.value as Json));
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { proc, problems };
}

export interface Built {
  readonly spec?: WorldSpec;
  readonly config?: ProceduralSpec;
  readonly problems: readonly string[];
}

/** Runs the strict parser on the edited document: the single source of structural validation. */
export function build(base: Base, proc: Json): Built {
  try {
    const spec = parseWorldSpec(dump({ ...base.doc, procedural: proc }, { lineWidth: -1, noRefs: true }));
    return { spec, config: spec.procedural, problems: [] };
  } catch (e) {
    return { problems: e instanceof WorldSpecError ? e.problems : [e instanceof Error ? e.message : String(e)] };
  }
}

/** Last write per path wins; entries equal to the authored value are dropped; sorted for a stable file. */
export function normaliseEdits(base: Base, edits: Edits): Change[] {
  const last = new Map<string, Json>();
  for (const e of edits) last.set(e.path, e.value);
  const out: Change[] = [];
  for (const [path, value] of last) {
    const before = getAt(base.proc, path.replace(/^procedural\.?/, ''));
    if (hashJson(before) !== hashJson(value)) out.push({ path, value });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Revision of a configuration: hash of the resolved `procedural:` mapping. */
export const revisionOf = (proc: Json): string => hashJson(proc);
