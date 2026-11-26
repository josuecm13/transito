/**
 * The sector table (specs/map/sectors.yaml; doc 03-technical/12-sectors-and-streaming.md section 1): the isthmus box
 * is tiled by 7 land sectors, the foundation for per-sector streaming. Pure: no DOM, no I/O. The sea is not a sector;
 * points outside the extent clamp to the nearest sector (the sea shell is global and always resident).
 *
 *   parseSectors(yaml, world?)  strict parse; problems of every kind are reported together
 *   sectorOf(t, x, y)           the sector owning a point; total over the plane (clamps into the extent)
 *   sectorAreas(t, cell = 20)   km2 per sector, counted on the cell grid by cell centre
 *   adjacency(t)                declared neighbours as a map id -> ids
 */
import { load } from 'js-yaml';
import type { WorldSpec } from './spec.ts';

export type SectorTier = 'full' | 'blocks' | 'silhouette';
export const SECTOR_TIERS: readonly SectorTier[] = ['full', 'blocks', 'silhouette'];

/** [minX, minY, maxX, maxY], half-open (min <= v < max); the extent's far edges are inclusive. */
export type SectorBox = readonly [number, number, number, number];

export interface Sector {
  id: string;
  name: string;
  tier: SectorTier;
  boxes: SectorBox[];
  /** Only for sectors that share a box: which side of `canal_border` the sector owns. */
  side?: 'west' | 'east';
  districts: string[];
  neighbours: string[];
}

export interface SectorTable {
  extent: { width: number; height: number };
  /** Polyline [x, y] with y rising; `side` sectors are west / east of it. */
  canalBorder: readonly (readonly [number, number])[];
  sectors: Sector[];
}

export class SectorSpecError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid sector table:\n- ${problems.join('\n- ')}`);
    this.name = 'SectorSpecError';
    this.problems = problems;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function exact(o: Obj, allowed: readonly string[], path: string, out: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) out.push(`${path}.${k}: unknown key (allowed: ${allowed.join(', ')})`);
}

function strings(v: unknown, path: string, out: string[]): string[] {
  if (!Array.isArray(v) || !v.every(isStr)) {
    out.push(`${path}: expected a list of ids`);
    return [];
  }
  return v as string[];
}

/** Strict parse. With `world`, every district id must exist in the world spec. */
export function parseSectors(yamlText: string, world?: Pick<WorldSpec, 'districts'>): SectorTable {
  const problems: string[] = [];
  const raw: unknown = load(yamlText);
  if (!isObj(raw)) throw new SectorSpecError(['sectors.yaml: expected a mapping']);
  exact(raw, ['extent', 'canal_border', 'sectors'], 'sectors.yaml', problems);

  let extent = { width: 0, height: 0 };
  if (isObj(raw.extent)) {
    exact(raw.extent, ['width', 'height'], 'extent', problems);
    const { width, height } = raw.extent;
    if (isNum(width) && isNum(height) && width > 0 && height > 0) extent = { width, height };
    else problems.push('extent: width and height must be positive numbers');
  } else problems.push('extent: missing');

  const border: [number, number][] = [];
  if (!Array.isArray(raw.canal_border) || raw.canal_border.length < 2) problems.push('canal_border: expected at least 2 [x, y] points');
  else {
    raw.canal_border.forEach((p: unknown, i: number) => {
      if (Array.isArray(p) && p.length === 2 && p.every(isNum)) border.push([p[0] as number, p[1] as number]);
      else problems.push(`canal_border[${i}]: expected [x, y]`);
    });
    for (let i = 1; i < border.length; i++) if (!(border[i]![1] > border[i - 1]![1])) problems.push(`canal_border[${i}]: y must rise`);
  }

  const sectors: Sector[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(raw.sectors) || raw.sectors.length === 0) problems.push('sectors: expected a non-empty list');
  else {
    raw.sectors.forEach((s: unknown, i: number) => {
      const path = `sectors[${i}]`;
      if (!isObj(s)) return void problems.push(`${path}: expected a mapping`);
      exact(s, ['id', 'name', 'tier', 'boxes', 'side', 'districts', 'neighbours'], path, problems);
      if (!isStr(s.id)) return void problems.push(`${path}.id: missing`);
      if (ids.has(s.id)) problems.push(`${path}.id: duplicate id "${s.id}"`);
      ids.add(s.id);
      if (!isStr(s.name)) problems.push(`${path}.name: missing`);
      if (!SECTOR_TIERS.includes(s.tier as SectorTier)) problems.push(`${path}.tier: must be one of ${SECTOR_TIERS.join(', ')}`);
      const boxes: SectorBox[] = [];
      if (!Array.isArray(s.boxes) || s.boxes.length === 0) problems.push(`${path}.boxes: expected a non-empty list`);
      else {
        s.boxes.forEach((b: unknown, j: number) => {
          const ok = Array.isArray(b) && b.length === 4 && b.every(isNum);
          const [x0, y0, x1, y1] = ok ? (b as number[]) : [0, 0, 0, 0];
          if (!ok || !(x0! < x1!) || !(y0! < y1!)) return void problems.push(`${path}.boxes[${j}]: expected [minX, minY, maxX, maxY] with min < max`);
          if (x0! < 0 || y0! < 0 || x1! > extent.width || y1! > extent.height) problems.push(`${path}.boxes[${j}]: outside the extent`);
          boxes.push([x0!, y0!, x1!, y1!]);
        });
      }
      if (s.side !== undefined && s.side !== 'west' && s.side !== 'east') problems.push(`${path}.side: must be west or east`);
      sectors.push({
        id: s.id,
        name: isStr(s.name) ? s.name : '',
        tier: s.tier as SectorTier,
        boxes,
        ...(s.side === 'west' || s.side === 'east' ? { side: s.side } : {}),
        districts: strings(s.districts, `${path}.districts`, problems),
        neighbours: strings(s.neighbours, `${path}.neighbours`, problems),
      });
    });
  }

  const byId = new Map(sectors.map((s) => [s.id, s] as const));
  const known = world ? new Set(world.districts.map((d) => d.id)) : undefined;
  for (const s of sectors) {
    for (const n of s.neighbours) {
      const other = byId.get(n);
      if (n === s.id) problems.push(`${s.id}.neighbours: lists itself`);
      else if (!other) problems.push(`${s.id}.neighbours: unknown sector "${n}"`);
      else if (!other.neighbours.includes(s.id)) problems.push(`${s.id}.neighbours: "${n}" does not list "${s.id}" back (neighbours must be symmetric)`);
    }
    if (known) for (const d of s.districts) if (!known.has(d)) problems.push(`${s.id}.districts: unknown district "${d}" (not in world.yaml)`);
    if (s.side && border.length < 2) problems.push(`${s.id}.side: needs canal_border`);
  }

  if (problems.length) throw new SectorSpecError(problems);
  return { extent, canalBorder: border, sectors };
}

/** x of the border polyline at y (clamped to its end points). */
function borderX(line: SectorTable['canalBorder'], y: number): number {
  if (y <= line[0]![1]) return line[0]![0];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!;
    const [bx, by] = line[i]!;
    if (y <= by) return ax + ((bx - ax) * (y - ay)) / (by - ay);
  }
  return line[line.length - 1]![0];
}

function owns(t: SectorTable, s: Sector, x: number, y: number): boolean {
  const { width, height } = t.extent;
  const inside = s.boxes.some(
    ([x0, y0, x1, y1]) => x >= x0 && (x < x1 || (x1 === width && x <= x1)) && y >= y0 && (y < y1 || (y1 === height && y <= y1)),
  );
  if (!inside || !s.side) return inside;
  const bx = borderX(t.canalBorder, y);
  return s.side === 'west' ? x < bx : x >= bx;
}

/**
 * The sector owning (x, y). Total: a point outside the extent clamps to the nearest point of the box, so it gets
 * the nearest sector (the sea belongs to the adjacent land sector; the global sea shell is not a sector).
 */
export function sectorOf(t: SectorTable, x: number, y: number): Sector {
  if (Number.isNaN(x) || Number.isNaN(y)) throw new RangeError('sectorOf: NaN coordinate');
  const cx = Math.min(t.extent.width, Math.max(0, x));
  const cy = Math.min(t.extent.height, Math.max(0, y));
  const hit = t.sectors.find((s) => owns(t, s, cx, cy));
  if (!hit) throw new Error(`sectorOf: (${x}, ${y}) is not covered by any sector (the boxes must tile the extent)`);
  return hit;
}

/** km2 per sector id, counting cell centres of a `cell` m grid over the extent (default 20 m: 300 x 400 cells). */
export function sectorAreas(t: SectorTable, cell = 20): Map<string, number> {
  const out = new Map<string, number>(t.sectors.map((s) => [s.id, 0]));
  const nx = Math.round(t.extent.width / cell);
  const ny = Math.round(t.extent.height / cell);
  const km2 = (cell * cell) / 1e6;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const id = sectorOf(t, (i + 0.5) * cell, (j + 0.5) * cell).id;
      out.set(id, out.get(id)! + km2);
    }
  return out;
}

/** Declared neighbours: sector id -> neighbour ids. */
export function adjacency(t: SectorTable): Map<string, string[]> {
  return new Map(t.sectors.map((s) => [s.id, [...s.neighbours]] as const));
}
