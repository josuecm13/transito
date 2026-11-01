import type { WalkGraph } from '../world/walk-graph.ts';
import { nextEdge } from '../world/walk-graph.ts';
import type { Rng } from '../world/rng.ts';
import type { Vec2 } from '../world/vec.ts';
import { normalize, sub } from '../world/vec.ts';

/** Position on a graph edge: t 0 -> 1 runs from edge.a to edge.b. */
export interface FollowerState {
  edge: number;
  t: number;
  forward: boolean;
  blocked: boolean;
}

const MAX_NODE_CROSSINGS = 16;

/** Advance `distance` meters along the edge, carrying the remainder across nodes. */
export function stepFollower(f: FollowerState, distance: number, graph: WalkGraph, rng: Rng): void {
  let remaining = distance;
  for (let i = 0; i < MAX_NODE_CROSSINGS && remaining > 0; i++) {
    const e = graph.edges[f.edge];
    if (!e) return;
    const room = (f.forward ? 1 - f.t : f.t) * e.length;
    if (remaining < room) {
      f.t += (f.forward ? remaining : -remaining) / e.length;
      return;
    }
    remaining -= room;
    const node = f.forward ? e.b : e.a;
    const next = nextEdge(graph, f.edge, node, rng);
    const ne = graph.edges[next];
    if (!ne) return;
    f.edge = next;
    f.forward = ne.a === node;
    f.t = f.forward ? 0 : 1;
  }
}

/** Turn around on the current edge. */
export function reverseFollower(f: FollowerState): void {
  f.forward = !f.forward;
}

/** Heading is unit; position is shifted to the right of the heading by laneOffset (spec plane, y north). */
export function followerPose(
  f: FollowerState,
  graph: WalkGraph,
  laneOffset: number,
): { position: Vec2; heading: Vec2 } {
  const e = graph.edges[f.edge];
  if (!e) throw new Error(`follower on unknown edge ${f.edge}`);
  const a = graph.nodes[e.a] as Vec2;
  const b = graph.nodes[e.b] as Vec2;
  const dir = normalize(f.forward ? sub(b, a) : sub(a, b));
  const right = { x: dir.y, y: -dir.x };
  return {
    position: {
      x: a.x + (b.x - a.x) * f.t + right.x * laneOffset,
      y: a.y + (b.y - a.y) * f.t + right.y * laneOffset,
    },
    heading: dir,
  };
}
