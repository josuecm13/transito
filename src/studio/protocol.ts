/**
 * The Map Studio protocol (#13): one pure `handle(state, request)` shared by the CLI and the UI.
 * No fs, no network. State is the authored world + saved edits + working edits; every response carries the
 * revision so agents can pass `expectedRevision`. Invalid or guard-breaking edits are refused and the last
 * valid state is kept; nothing is repaired silently.
 */
import { generateIsthmus, isthmusRenderInput, type Isthmus } from '../world/proc/isthmus.ts';
import { renderMap } from '../world/proc/render.ts';
import { Hasher } from './hash.ts';
import { runGuards, type Violation } from './guards.ts';
import { hashesOf, metricsOf, type Hashes, type Metrics } from './metrics.ts';
import { jsonSchema, listParams } from './params.ts';
import { DISTRICT_PRESETS, presetById } from './presets.ts';
import { getAt, type Json } from './paths.ts';
import { applyEdits, build, normaliseEdits, openBase, revisionOf, type Base, type Change, type Edits } from './session.ts';

export const PROTOCOL_VERSION = 1;
export const COARSE_CELL = 40;

export interface State {
  readonly base: Base;
  readonly saved: Edits;
  readonly working: Edits;
}

export type Request =
  | { op: 'describe'; version?: number }
  | { op: 'inspect'; version?: number; generate?: boolean; cell?: number }
  | { op: 'patch'; version?: number; changes: Change[]; dryRun?: boolean; expectedRevision?: string; cell?: number }
  | { op: 'move-anchor'; version?: number; anchor: string; to: [number, number]; force?: boolean; dryRun?: boolean; expectedRevision?: string; cell?: number }
  | { op: 'set-ridge'; version?: number; id: string; points?: [number, number][]; width?: number; rate?: number; at?: [number, number]; radius?: number; dryRun?: boolean; expectedRevision?: string; cell?: number }
  | { op: 'set-district'; version?: number; id: string; targetKm2?: number; roadAffinity?: number; reach?: number; patchThreshold?: number; dryRun?: boolean; expectedRevision?: string; cell?: number }
  | { op: 'set-route'; version?: number; id: string; stops: string[]; dryRun?: boolean; expectedRevision?: string; cell?: number }
  | { op: 'add-district'; version?: number; preset: string; id?: string; at?: [number, number]; along?: string; sigma?: number; weight?: number; dryRun?: boolean; expectedRevision?: string; cell?: number }
  | { op: 'remove-district'; version?: number; id: string; dryRun?: boolean; expectedRevision?: string; cell?: number }
  | { op: 'validate'; version?: number; cell?: number }
  | { op: 'diff'; version?: number; against?: 'base' | 'saved'; cell?: number }
  | { op: 'generate' | 'preview'; version?: number; cell?: number; metresPerPixel?: number }
  | { op: 'save' | 'export' | 'reset'; version?: number; cell?: number }
  | { op: 'revert'; version?: number; to: 'base' | 'saved' };

export interface Response {
  ok: boolean;
  version: number;
  revision: string;
  changed?: { path: string; before: Json | undefined; after: Json }[];
  metrics?: Metrics;
  hashes?: Hashes;
  violations?: Violation[];
  warnings: string[];
  errors: string[];
  data?: unknown;
}

export interface Outcome {
  response: Response;
  /** New working edits, when the request changed them. */
  working?: Edits;
  /** New saved edits (`save`): the CLI persists them atomically. */
  saved?: Edits;
  /** Rendered preview, for the CLI/UI to encode. */
  image?: { width: number; height: number; rgb: Uint8Array };
}

const resolve = (s: State, edits: Edits) => applyEdits(s.base, edits);
const revisionFor = (s: State, edits: Edits): string => {
  const r = resolve(s, edits);
  return r.problems.length ? 'invalid' : revisionOf(r.proc);
};

interface Evaluated {
  iso: Isthmus;
  metrics: Metrics;
  hashes: Hashes;
  violations: Violation[];
}

// Generating is the whole cost of a request (1.4 s at 40 m, 6 s at 20 m), and an edit asks for the same
// (configuration, cell) several times: before/after of a patch, then the preview. Evaluated maps are
// pure functions of the resolved configuration, so the last few are kept per base document.
const MEMO_SIZE = 3;
const memo = new WeakMap<Base, Map<string, Evaluated>>();

export function evaluate(s: State, edits: Edits, cell: number): { ev?: Evaluated; errors: string[] } {
  const r = resolve(s, edits);
  if (r.problems.length) return { errors: [...r.problems] };
  const key = `${revisionOf(r.proc)}@${cell}`;
  const cache = memo.get(s.base) ?? new Map<string, Evaluated>();
  memo.set(s.base, cache);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recently used last
    return { ev: hit, errors: [] };
  }
  const res = evaluateUncached(s, r.proc, cell);
  if (res.ev) {
    cache.set(key, res.ev);
    if (cache.size > MEMO_SIZE) cache.delete(cache.keys().next().value!);
  }
  return res;
}

function evaluateUncached(s: State, proc: Json, cell: number): { ev?: Evaluated; errors: string[] } {
  const b = build(s.base, proc);
  if (!b.spec || !b.config) return { errors: [...b.problems] };
  // The generator throws when an edit leaves a route or track unreachable: that is a refusal, not a crash.
  let iso: Isthmus;
  try {
    iso = generateIsthmus(b.spec, { cell, config: b.config });
  } catch (e) {
    return { errors: [`generation failed: ${e instanceof Error ? e.message : String(e)}. The edit makes the map unbuildable; the last valid state is kept.`] };
  }
  const metrics = metricsOf(iso, b.config);
  return { ev: { iso, metrics, hashes: hashesOf(iso), violations: runGuards(iso, b.config, metrics) }, errors: [] };
}

const resp = (s: State, patch: Partial<Response> = {}): Response => ({
  ok: true,
  version: PROTOCOL_VERSION,
  revision: revisionFor(s, s.working),
  warnings: [],
  errors: [],
  ...patch,
});
const fail = (s: State, errors: string[], patch: Partial<Response> = {}): Outcome => ({ response: resp(s, { ok: false, errors, ...patch }) });

/** Anchors an agent may move by name. Hard anchors (canal ends, locks) need `force`: they define the approved map. */
export function anchorPath(proc: Json, anchor: string): { path: string; hard: boolean } | undefined {
  const [kind, a, b] = anchor.split(':');
  switch (kind) {
    case 'stop':
      return a === 'roads' || a === 'transit' ? (getAt(proc, `${a}.stops.${b}`) ? { path: `procedural.${a}.stops.${b}`, hard: false } : undefined) : undefined;
    case 'district':
      return getAt(proc, `districts.items[id=${a}].at`) ? { path: `procedural.districts.items[id=${a}].at`, hard: false } : undefined;
    case 'seed':
      return getAt(proc, `towns.items[id=${a}].seeds[${b ?? 0}]`) ? { path: `procedural.towns.items[id=${a}].seeds[${b ?? 0}]`, hard: false } : undefined;
    case 'hint':
      return a === 'airport' ? { path: 'procedural.airport.hint', hard: false } : a === 'dam' ? { path: 'procedural.lake.dam_hint', hard: false } : undefined;
    case 'canal':
      return a === 'caribbean' || a === 'pacific' || a === 'pacific_locks' ? { path: `procedural.canal.${a}`, hard: true } : undefined;
    default:
      return undefined;
  }
}

function toChanges(s: State, req: Request): { changes: Change[]; errors: string[] } {
  const proc = resolve(s, s.working).proc;
  const bounds = (s.base.doc.bounds ?? {}) as { width?: number; height?: number };
  switch (req.op) {
    case 'patch':
      return { changes: req.changes, errors: [] };
    case 'move-anchor': {
      const a = anchorPath(proc, req.anchor);
      if (!a) return { changes: [], errors: [`unknown anchor '${req.anchor}' (stop:roads:<id>, stop:transit:<id>, seed:<town>:<n>, district:<id>, hint:airport, hint:dam, canal:<name>)`] };
      if (a.hard && !req.force) return { changes: [], errors: [`${req.anchor} is a hard anchor of the approved map; pass "force": true to move it`] };
      const [x, y] = req.to;
      if (!(x >= 0 && y >= 0 && x <= (bounds.width ?? Infinity) && y <= (bounds.height ?? Infinity))) return { changes: [], errors: [`${req.anchor}: (${x}, ${y}) is outside the map`] };
      return { changes: [{ path: a.path, value: [x, y] }], errors: [] };
    }
    case 'set-ridge': {
      const base = `procedural.relief.zones[id=${req.id}]`;
      if (!getAt(proc, `relief.zones[id=${req.id}]`)) return { changes: [], errors: [`no ridge zone '${req.id}'`] };
      const c: Change[] = [];
      if (req.points) c.push({ path: `${base}.points`, value: req.points });
      if (req.at) c.push({ path: `${base}.at`, value: req.at });
      for (const k of ['width', 'rate', 'radius'] as const) if (req[k] !== undefined) c.push({ path: `${base}.${k}`, value: req[k]! });
      return { changes: c, errors: c.length ? [] : ['set-ridge: nothing to change'] };
    }
    case 'set-district': {
      const base = `procedural.towns.items[id=${req.id}]`;
      if (!getAt(proc, `towns.items[id=${req.id}]`)) return { changes: [], errors: [`no town '${req.id}'`] };
      const c: Change[] = [];
      if (req.targetKm2 !== undefined) c.push({ path: `${base}.target_km2`, value: req.targetKm2 });
      if (req.roadAffinity !== undefined) c.push({ path: `${base}.road_affinity`, value: req.roadAffinity });
      if (req.reach !== undefined) c.push({ path: `${base}.seed_along.reach`, value: req.reach });
      if (req.patchThreshold !== undefined) c.push({ path: `${base}.patches.threshold`, value: req.patchThreshold });
      return { changes: c, errors: c.length ? [] : ['set-district: nothing to change'] };
    }
    case 'add-district': {
      const pr = presetById(req.preset);
      if (!pr) return { changes: [], errors: [`unknown preset '${req.preset}' (${DISTRICT_PRESETS.map((x) => x.id).join(', ')})`] };
      const id = req.id ?? pr.id;
      const items = (getAt(proc, 'districts.items') as Json[] | undefined) ?? [];
      if (items.some((e) => (e as { id?: string }).id === id)) return { changes: [], errors: [`district '${id}' already exists; pass another "id" or edit it with patch`] };
      const item: { [k: string]: Json } = { id, style: pr.style };
      if (pr.anchor === 'at') {
        if (!req.at) return { changes: [], errors: [`preset ${pr.id} is placed with "at": [x, y]`] };
        const [x, y] = req.at;
        if (!(x >= 0 && y >= 0 && x <= (bounds.width ?? Infinity) && y <= (bounds.height ?? Infinity))) return { changes: [], errors: [`add-district: (${x}, ${y}) is outside the map`] };
        item.at = [x, y];
      } else if (pr.anchor === 'along') {
        if (!req.along) return { changes: [], errors: [`preset ${pr.id} follows a road route: pass "along": "<route id>"`] };
        item.along = req.along;
      } else item.around = 'airport';
      item.sigma = req.sigma ?? pr.sigma;
      item.weight = req.weight ?? pr.weight;
      return { changes: [{ path: 'procedural.districts.items', value: [...items, item] }], errors: [] };
    }
    case 'remove-district': {
      const items = (getAt(proc, 'districts.items') as Json[] | undefined) ?? [];
      if (!items.some((e) => (e as { id?: string }).id === req.id)) return { changes: [], errors: [`no district '${req.id}'`] };
      return { changes: [{ path: 'procedural.districts.items', value: items.filter((e) => (e as { id?: string }).id !== req.id) }], errors: [] };
    }
    case 'set-route':
      return getAt(proc, `roads.routes[id=${req.id}]`)
        ? { changes: [{ path: `procedural.roads.routes[id=${req.id}].stops`, value: req.stops }], errors: [] }
        : { changes: [], errors: [`no road route '${req.id}'`] };
    default:
      return { changes: [], errors: [`not an edit op: ${req.op}`] };
  }
}

function changedOf(s: State, a: Edits, b: Edits): NonNullable<Response['changed']> {
  const pa = resolve(s, a).proc;
  const pb = resolve(s, b).proc;
  const paths = new Set([...a, ...b].map((c) => c.path));
  const out: NonNullable<Response['changed']> = [];
  for (const path of [...paths].sort()) {
    const rel = path.replace(/^procedural\./, '');
    const before = getAt(pa, rel);
    const after = getAt(pb, rel);
    if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ path, before, after: after as Json });
  }
  return out;
}

export function handle(s: State, req: Request): Outcome {
  if (req.version !== undefined && req.version !== PROTOCOL_VERSION) return fail(s, [`protocol version ${req.version} is not supported (this is ${PROTOCOL_VERSION})`]);
  const cell = ('cell' in req && req.cell) || COARSE_CELL;
  switch (req.op) {
    case 'describe': {
      const proc = s.base.proc;
      return {
        response: resp(s, {
          data: {
            protocol: PROTOCOL_VERSION,
            coordinates: 'metres, origin south-west, +x east, +y north; map 6000 × 8000 m',
            ops: ['describe', 'inspect', 'patch', 'move-anchor', 'set-ridge', 'set-district', 'set-route', 'add-district', 'remove-district', 'validate', 'diff', 'generate', 'preview', 'save', 'export', 'revert', 'reset'],
            pathSyntax: 'procedural.lake.target_km2 · procedural.towns.items[id=el-corredor].target_km2 · procedural.roads.stops.city',
            cells: { coarse: COARSE_CELL, default: (proc as { cell?: number }).cell, note: 'pass "cell" to trade speed for detail; hashes are per cell' },
            districtPresets: DISTRICT_PRESETS,
            parameters: listParams(proc),
            jsonSchema: jsonSchema(proc),
            examples: [
              { op: 'patch', dryRun: true, changes: [{ path: 'procedural.towns.items[id=la-ciudad].target_km2', value: 1.9 }] },
              { op: 'move-anchor', anchor: 'stop:transit:casco', to: [2560, 760], dryRun: true },
              { op: 'set-ridge', id: 'cordillera', width: 2000 },
              { op: 'set-district', id: 'la-ciudad', targetKm2: 2.2 },
              { op: 'add-district', preset: 'paitilla-pacifica-towers', at: [3300, 1000], dryRun: true },
            ],
          },
        }),
      };
    }
    case 'inspect': {
      const r = resolve(s, s.working);
      const proc = r.proc;
      const data = {
        edits: { saved: s.saved.length, working: s.working.length, unsaved: JSON.stringify(s.saved) !== JSON.stringify(s.working) },
        anchors: {
          roadStops: getAt(proc, 'roads.stops'),
          transitStops: getAt(proc, 'transit.stops'),
          airportHint: getAt(proc, 'airport.hint'),
          damHint: getAt(proc, 'lake.dam_hint'),
          canal: { caribbean: getAt(proc, 'canal.caribbean'), pacificLocks: getAt(proc, 'canal.pacific_locks'), pacific: getAt(proc, 'canal.pacific') },
          towns: (getAt(proc, 'towns.items') as { id: string; seeds?: Json; target_km2: number }[]).map((t) => ({ id: t.id, seeds: t.seeds, targetKm2: t.target_km2 })),
        },
        layers: ['relief.zones', 'districts.items', 'lake', 'rivers', 'canal', 'airport', 'roads.routes', 'towns.items', 'transit.lines', 'landmarks'],
        zones: (getAt(proc, 'relief.zones') as Json[]).map((z) => z),
        config: proc,
      };
      if (!('generate' in req) || !req.generate) return { response: resp(s, { data }) };
      const { ev, errors } = evaluate(s, s.working, cell);
      if (!ev) return fail(s, errors);
      return { response: resp(s, { data, metrics: ev.metrics, hashes: ev.hashes, violations: ev.violations }) };
    }
    case 'validate': {
      const { ev, errors } = evaluate(s, s.working, cell);
      if (!ev) return fail(s, errors);
      return { response: resp(s, { ok: ev.violations.length === 0, metrics: ev.metrics, hashes: ev.hashes, violations: ev.violations, errors: ev.violations.map((v) => `${v.guard}: ${v.message}`) }) };
    }
    case 'generate':
    case 'preview': {
      const { ev, errors } = evaluate(s, s.working, cell);
      if (!ev) return fail(s, errors);
      const out: Outcome = { response: resp(s, { metrics: ev.metrics, hashes: ev.hashes, violations: ev.violations, warnings: ev.violations.map((v) => `${v.guard}: ${v.message}`) }) };
      if (req.op === 'preview') {
        const img = renderMap(isthmusRenderInput(ev.iso), { metresPerPixel: req.metresPerPixel ?? 10, exaggeration: 2.2, seed: 5 });
        out.image = { width: img.width, height: img.height, rgb: img.rgb };
        out.response.data = { width: img.width, height: img.height, pixelHash: new Hasher().floats(Array.from(img.rgb.subarray(0, Math.min(img.rgb.length, 4_000_000)))).hex() };
      }
      return out;
    }
    case 'diff': {
      const from = req.against === 'base' ? [] : s.saved;
      const changed = changedOf(s, from, s.working);
      const a = evaluate(s, from, cell);
      const b = evaluate(s, s.working, cell);
      if (!a.ev || !b.ev) return fail(s, [...a.errors, ...b.errors]);
      const delta: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of Object.keys(a.ev.metrics) as (keyof Metrics)[]) if (JSON.stringify(a.ev.metrics[k]) !== JSON.stringify(b.ev.metrics[k])) delta[k] = { from: a.ev.metrics[k], to: b.ev.metrics[k] };
      return { response: resp(s, { changed, metrics: b.ev.metrics, hashes: b.ev.hashes, violations: b.ev.violations, data: { against: req.against ?? 'saved', metricDelta: delta, hashesFrom: a.ev.hashes } }) };
    }
    case 'save': {
      // Saved maps are validated at the authored cell (the preview cell is a speed trade-off; hashes are per cell).
      const authored = (s.base.proc as { cell?: number }).cell ?? COARSE_CELL;
      const saveCell = 'cell' in req && req.cell ? req.cell : authored;
      const { ev, errors } = evaluate(s, s.working, saveCell);
      if (!ev) return fail(s, errors);
      if (ev.violations.length) return fail(s, ev.violations.map((v) => `${v.guard}: ${v.message}`), { violations: ev.violations });
      return { response: resp(s, { changed: changedOf(s, s.saved, s.working), data: { edits: s.working.length, validatedAtCell: saveCell } }), saved: s.working };
    }
    case 'export':
      return { response: resp(s, { data: { config: resolve(s, s.working).proc, edits: s.working } }) };
    case 'reset':
      return { response: resp({ ...s, working: [] }), working: [] };
    case 'revert': {
      const to = req.to === 'base' ? [] : s.saved;
      return { response: resp({ ...s, working: to }, { changed: changedOf(s, s.working, to) }), working: to };
    }
    default: {
      // patch, move-anchor, set-ridge, set-district, set-route
      const edit = req as Extract<Request, { dryRun?: boolean; expectedRevision?: string }>;
      const current = revisionFor(s, s.working);
      if (edit.expectedRevision && edit.expectedRevision !== current) return fail(s, [`revision mismatch: expected ${edit.expectedRevision}, the map is at ${current}; inspect again`]);
      const { changes, errors } = toChanges(s, req);
      if (errors.length) return fail(s, errors);
      const next = normaliseEdits(s.base, [...s.working, ...changes]);
      const before = evaluate(s, s.working, cell);
      const after = evaluate(s, next, cell);
      if (!after.ev) return fail(s, after.errors);
      const known = new Set((before.ev?.violations ?? []).map((v) => `${v.guard}`));
      const introduced = after.ev.violations.filter((v) => !known.has(v.guard));
      const out = {
        changed: changedOf(s, s.working, next),
        metrics: after.ev.metrics,
        hashes: after.ev.hashes,
        violations: after.ev.violations,
        data: before.ev ? { metricsBefore: before.ev.metrics, hashesBefore: before.ev.hashes } : undefined,
      };
      if (introduced.length)
        return fail(s, introduced.map((v) => `conflict — ${v.guard}: ${v.message}. The last valid state is kept.`), { ...out, revision: current });
      const newRevision = revisionFor(s, next);
      const base = { ...out, revision: dryRunRev(edit.dryRun, current, newRevision), warnings: after.ev.violations.map((v) => `${v.guard}: ${v.message}`) };
      return edit.dryRun ? { response: resp(s, { ...base, data: { ...(out.data as object), dryRun: true, wouldBecomeRevision: newRevision } }) } : { response: resp({ ...s, working: next }, base), working: next };
    }
  }
}
const dryRunRev = (dry: boolean | undefined, current: string, next: string): string => (dry ? current : next);
export { openBase };
