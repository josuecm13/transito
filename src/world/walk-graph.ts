import type { WorldSpec } from './spec.ts';
import type { WorldSlice, Street } from './slice.ts';
import type { Vec2 } from './vec.ts';
import { distance, lerp } from './vec.ts';
import type { Rng } from './rng.ts';
import { distanceToPolyline, offsetPolyline } from './geometry.ts';

export type WalkEdge = { a: number; b: number; length: number; kind: 'sidewalk' | 'crossing' };
export type WalkGraph = { nodes: Vec2[]; edges: WalkEdge[]; adjacency: number[][] };

const JUNCTION_MARGIN = 2;

export function buildWalkGraph(spec: WorldSpec, slice: WorldSlice): WalkGraph {
  const walkOn = new Set(spec.population.pedestrians.walkOn);
  const pieces = slice.streets.filter((s) => walkOn.has(s.kind) && s.centerline.length >= 2);

  const nodes: Vec2[] = [];
  const edges: WalkEdge[] = [];
  const addNode = (p: Vec2): number => nodes.push(p) - 1;
  const addEdge = (a: number, b: number, kind: WalkEdge['kind']): void => {
    edges.push({ a, b, length: distance(nodes[a] as Vec2, nodes[b] as Vec2), kind });
  };

  type Sides = { left: number[]; right: number[] };
  const sides: Sides[] = [];
  for (const s of pieces) {
    const off = s.width / 2 + s.sidewalk / 2;
    const l = offsetPolyline(s.centerline, off);
    const r = offsetPolyline(s.centerline, -off);
    const left = l.map(addNode);
    const right = r.map(addNode);
    for (let i = 0; i < left.length - 1; i++) {
      addEdge(left[i] as number, left[i + 1] as number, 'sidewalk');
      addEdge(right[i] as number, right[i + 1] as number, 'sidewalk');
    }
    for (let i = 0; i < left.length; i++) addEdge(left[i] as number, right[i] as number, 'crossing');
    sides.push({ left, right });
  }

  const nearestNode = (p: Vec2, ids: number[]): number => {
    let best = ids[0] as number;
    let bd = Infinity;
    for (const id of ids) {
      const d = distance(p, nodes[id] as Vec2);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  };

  // Junctions: an endpoint of one piece near another piece's carriageway.
  pieces.forEach((s: Street, ai) => {
    const sa = sides[ai] as Sides;
    const ends: [number, Vec2][] = [
      [0, s.centerline[0] as Vec2],
      [s.centerline.length - 1, s.centerline[s.centerline.length - 1] as Vec2],
    ];
    pieces.forEach((o: Street, bi) => {
      if (bi === ai) return;
      const so = sides[bi] as Sides;
      const reach = o.width / 2 + o.sidewalk + JUNCTION_MARGIN;
      for (const [idx, p] of ends) {
        if (distanceToPolyline(p, o.centerline) > reach) continue;
        const targets = [...so.left, ...so.right];
        for (const n of [sa.left[idx] as number, sa.right[idx] as number]) {
          addEdge(n, nearestNode(nodes[n] as Vec2, targets), 'sidewalk');
        }
      }
    });
  });

  // Drop nodes off playable land (and their edges), then nodes left without edges; reindex.
  const alive = nodes.map((p) => slice.isPlayableLand(p));
  const kept = edges.filter((e) => alive[e.a] && alive[e.b]);
  const used = new Array<boolean>(nodes.length).fill(false);
  for (const e of kept) {
    used[e.a] = true;
    used[e.b] = true;
  }
  const remap = new Array<number>(nodes.length).fill(-1);
  const outNodes: Vec2[] = [];
  nodes.forEach((p, i) => {
    if (used[i]) remap[i] = outNodes.push(p) - 1;
  });
  const outEdges: WalkEdge[] = kept.map((e) => ({ ...e, a: remap[e.a] as number, b: remap[e.b] as number }));
  const adjacency: number[][] = outNodes.map(() => []);
  outEdges.forEach((e, id) => {
    (adjacency[e.a] as number[]).push(id);
    if (e.b !== e.a) (adjacency[e.b] as number[]).push(id);
  });
  return { nodes: outNodes, edges: outEdges, adjacency };
}

export function otherEnd(graph: WalkGraph, edgeId: number, node: number): number {
  const e = graph.edges[edgeId] as WalkEdge;
  return e.a === node ? e.b : e.a;
}

/** Random edge at the node, never straight back unless that is the only option (dead end). */
export function nextEdge(graph: WalkGraph, arrivedVia: number, atNode: number, rng: Rng): number {
  const options = (graph.adjacency[atNode] as number[]).filter((id) => id !== arrivedVia);
  if (options.length === 0) return arrivedVia;
  return rng.pick(options);
}

export function pointOnEdge(graph: WalkGraph, edgeId: number, t: number): Vec2 {
  const e = graph.edges[edgeId] as WalkEdge;
  return lerp(graph.nodes[e.a] as Vec2, graph.nodes[e.b] as Vec2, t);
}
