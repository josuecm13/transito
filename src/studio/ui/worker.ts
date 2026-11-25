/**
 * Generation worker for the Map Studio page. It owns the protocol state (authored world, saved and working
 * edits) and runs every request through `handle`, the same function the CLI uses; nothing about terrain or
 * validation lives here. Jobs queue; a preview that a newer job has overtaken is dropped before it runs
 * (a running generation cannot be interrupted, so the page also ignores results whose generation is old).
 */
import { handle, openBase, type Request, type State } from '../protocol.ts';
import { parseEdits } from '../saved.ts';
import type { Edits } from '../session.ts';
import type { FromWorker, ToWorker } from './messages.ts';

const ctx = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };

let state: State | undefined;
type Job = Extract<ToWorker, { type: 'job' }>;
const queue: Job[] = [];
let pumping = false;

const droppable = (j: Job): boolean => j.kind === 'preview' || j.kind === 'before';

function pump(): void {
  const job = queue.shift();
  if (!job) {
    pumping = false;
    return;
  }
  // A preview/before is stale when anything newer (any kind) waits behind it.
  if (droppable(job) && queue.some((q) => q.id > job.id && (!droppable(q) || q.gen > job.gen))) {
    ctx.postMessage({ type: 'dropped', id: job.id, gen: job.gen, kind: job.kind });
    setTimeout(pump, 0);
    return;
  }
  const t = performance.now();
  try {
    const s = state!;
    let req: Request = job.req;
    let run: State = s;
    if (job.kind === 'before') run = { ...s, working: [] };
    if (job.kind === 'restore') {
      // Undo/redo: the whole edit list goes through the same patch + guards, from the authored map.
      run = { ...s, working: [] };
      req = { op: 'patch', changes: [...(job.edits ?? [])], cell: 'cell' in job.req ? job.req.cell : undefined };
    }
    const outcome = handle(run, req);
    if (outcome.working && job.kind !== 'before') state = { ...s, working: outcome.working };
    if (outcome.saved) state = { ...state!, saved: outcome.saved };
    ctx.postMessage({ type: 'done', id: job.id, gen: job.gen, kind: job.kind, ms: Math.round(performance.now() - t), outcome, working: state!.working, cell: ('cell' in req && req.cell) || 0 });
  } catch (e) {
    ctx.postMessage({ type: 'error', id: job.id, gen: job.gen, kind: job.kind, message: e instanceof Error ? e.message : String(e) });
  }
  setTimeout(pump, 0);
}

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const saved: Edits = m.savedJson ? parseEdits(m.savedJson) : [];
    state = { base: openBase(m.yaml), saved, working: saved };
    ctx.postMessage({ type: 'ready', saved, working: saved });
    return;
  }
  queue.push(m);
  if (!pumping) {
    pumping = true;
    setTimeout(pump, 0);
  }
};
