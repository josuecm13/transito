import type { Vec2 } from '../world/vec.ts';

export interface SpatialHash {
  clear(): void;
  insert(id: number, p: Vec2): void;
  /** Ids whose cell overlaps the query disc's bounding box (a superset: callers do the exact test). */
  query(p: Vec2, radius: number): number[];
}

export function createSpatialHash(cellSize: number): SpatialHash {
  if (!(cellSize > 0)) throw new Error('cellSize must be > 0');
  const cells = new Map<string, { id: number; p: Vec2 }[]>();
  const key = (cx: number, cy: number): string => `${cx},${cy}`;
  const cell = (v: number): number => Math.floor(v / cellSize);
  return {
    clear: () => cells.clear(),
    insert(id, p) {
      const k = key(cell(p.x), cell(p.y));
      const list = cells.get(k);
      if (list) list.push({ id, p });
      else cells.set(k, [{ id, p }]);
    },
    query(p, radius) {
      const out: number[] = [];
      const x0 = cell(p.x - radius);
      const x1 = cell(p.x + radius);
      const y0 = cell(p.y - radius);
      const y1 = cell(p.y + radius);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const list = cells.get(key(cx, cy));
          if (!list) continue;
          for (const e of list) if (Math.hypot(e.p.x - p.x, e.p.y - p.y) <= radius) out.push(e.id);
        }
      }
      return out;
    },
  };
}
