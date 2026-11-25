/** Messages between the Map Studio page and its generation worker. */
import type { Edits } from '../session.ts';
import type { Outcome, Request } from '../protocol.ts';

export type JobKind =
  /** An edit the user made: applied to the working state when accepted. Never dropped. */
  | 'edit'
  /** Re-apply a whole edit list (undo / redo). Never dropped. */
  | 'restore'
  /** A render of the working state (coarse 40 m, or the validated cell). Dropped when a newer job is queued. */
  | 'preview'
  /** A render of the authored map, for the compare view. Dropped like a preview. */
  | 'before'
  | 'save'
  /** describe / export: cheap reads of the protocol. Never dropped. */
  | 'query';

export type ToWorker =
  | { type: 'init'; yaml: string; savedJson?: string }
  | { type: 'job'; id: number; gen: number; kind: JobKind; req: Request; edits?: Edits };

export type FromWorker =
  | { type: 'ready'; saved: Edits; working: Edits }
  | { type: 'done'; id: number; gen: number; kind: JobKind; ms: number; outcome: Outcome; working: Edits; cell: number }
  | { type: 'dropped'; id: number; gen: number; kind: JobKind }
  | { type: 'error'; id: number; gen: number; kind: JobKind; message: string };
