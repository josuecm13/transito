/**
 * Airport siting: search positions and headings near a hint for the airfield rectangle that needs the
 * least earthwork (height spread inside it), staying on dry land. The runways are then laid inside
 * the chosen rectangle and the terrain is levelled to its mean.
 */
import type { Vec2 } from '../vec.ts';
import { cellAt, sample, type FieldGrid, type MaskGrid } from './grid.ts';

export interface AirportParams {
  readonly hint: Vec2;
  /** Search radius around the hint (m). */
  readonly radius: number;
  /** Runway length and spacing between the two parallel runways (m). */
  readonly runwayLength: number;
  readonly runwaySpacing: number;
  readonly runwayWidth: number;
  /** Margin around the runways that must also be dry and flat (m). */
  readonly margin: number;
  /** Penalty per metre of distance from the hint, in metres of height spread. */
  readonly distanceWeight: number;
  /** Score penalty (m) for a field made entirely of river cells; scaled by the river share. */
  readonly culvertPenalty: number;
  /** Where the airport is reached from (the city): the terminal sits on that side. */
  readonly towards: Vec2;
  /** Allowed runway headings, degrees clockwise from north (Tocumen's runways are ~29°). */
  readonly headingRange: readonly [number, number];
  /** Apron and terminal size (m): apron length along the runways, apron depth, terminal building size. */
  readonly apron: { readonly length: number; readonly depth: number; readonly building: readonly [number, number] };
  /** The airfield stays this far inside the map frame (m). */
  readonly edgeMargin: number;
}

export interface AirportResult {
  readonly centre: Vec2;
  /** Unit vector along the runways. */
  readonly dir: Vec2;
  readonly level: number;
  readonly field: readonly Vec2[];
  readonly runways: readonly { readonly a: Vec2; readonly b: Vec2; readonly width: number }[];
  /** Terminal: just outside the airfield, on the long side facing `towards`. */
  readonly terminal: Vec2;
  /** Apron (paved stand area) and terminal building, inside the field on the terminal side. */
  readonly apronRing: readonly Vec2[];
  readonly buildingRing: readonly Vec2[];
  /** Parallel taxiway between the apron and the near runway. */
  readonly taxiway: { readonly a: Vec2; readonly b: Vec2; readonly width: number };
  readonly spread: number;
}

function rect(c: Vec2, d: Vec2, halfL: number, halfW: number): Vec2[] {
  const nx = -d.y;
  const ny = d.x;
  return [
    { x: c.x - d.x * halfL - nx * halfW, y: c.y - d.y * halfL - ny * halfW },
    { x: c.x + d.x * halfL - nx * halfW, y: c.y + d.y * halfL - ny * halfW },
    { x: c.x + d.x * halfL + nx * halfW, y: c.y + d.y * halfL + ny * halfW },
    { x: c.x - d.x * halfL + nx * halfW, y: c.y - d.y * halfL + ny * halfW },
  ];
}

/**
 * `water` cells are forbidden (sea, lake, canal); `soft` cells (rivers to culvert) add
 * `p.culvertPenalty` metres of score per sampled cell.
 */
export function siteAirport(height: FieldGrid, land: MaskGrid, water: MaskGrid, soft: MaskGrid, p: AirportParams): AirportResult {
  const halfL = p.runwayLength / 2 + p.margin;
  const halfW = p.runwaySpacing / 2 + p.margin;
  const step = 80;
  let best: { c: Vec2; d: Vec2; spread: number; mean: number; score: number } | undefined;
  for (let oy = -p.radius; oy <= p.radius; oy += step) {
    for (let ox = -p.radius; ox <= p.radius; ox += step) {
      if (ox * ox + oy * oy > p.radius * p.radius) continue;
      const c = { x: p.hint.x + ox, y: p.hint.y + oy };
      for (let deg = p.headingRange[0]; deg <= p.headingRange[1]; deg += 5) {
        const a = (deg * Math.PI) / 180;
        const d = { x: Math.sin(a), y: Math.cos(a) };
        let sum = 0;
        let sum2 = 0;
        let k = 0;
        let culverts = 0;
        let ok = true;
        for (let u = -halfL; u <= halfL && ok; u += 30) {
          for (let v = -halfW; v <= halfW; v += 30) {
            const x = c.x + d.x * u - d.y * v;
            const y = c.y + d.y * u + d.x * v;
            if (x < p.edgeMargin || y < p.edgeMargin || x > height.w * height.cell - p.edgeMargin || y > height.h * height.cell - p.edgeMargin) {
              ok = false;
              break;
            }
            const i = cellAt(height, x, y);
            if (!land.data[i] || water.data[i]) {
              ok = false;
              break;
            }
            if (soft.data[i]) culverts++;
            const h = sample(height, x, y);
            sum += h;
            sum2 += h * h;
            k++;
          }
        }
        if (!ok || k === 0) continue;
        const mean = sum / k;
        const spread = Math.sqrt(Math.max(0, sum2 / k - mean * mean));
        const score = spread + p.distanceWeight * Math.hypot(ox, oy) + (p.culvertPenalty * culverts) / k;
        if (!best || score < best.score) best = { c, d, spread, mean, score };
      }
    }
  }
  if (!best) throw new Error('siteAirport: no dry site in the search radius');
  const { c, d } = best;
  const nx = -d.y;
  const ny = d.x;
  const half = p.runwayLength / 2;
  const off = p.runwaySpacing / 2;
  const runways = [-off, off].map((o) => ({
    a: { x: c.x - d.x * half + nx * o, y: c.y - d.y * half + ny * o },
    b: { x: c.x + d.x * half + nx * o, y: c.y + d.y * half + ny * o },
    width: p.runwayWidth,
  }));
  // Terminal on the long side facing the hint's direction from the city (p.towards).
  const side = (p.towards.x - c.x) * nx + (p.towards.y - c.y) * ny >= 0 ? 1 : -1;
  const terminal = { x: c.x + nx * side * (halfW + 90), y: c.y + ny * side * (halfW + 90) };
  // Apron hugs the field edge on the terminal side; the taxiway runs between it and the near runway.
  const apronOff = halfW - p.apron.depth / 2;
  const apronC = { x: c.x + nx * side * apronOff, y: c.y + ny * side * apronOff };
  const bOff = halfW - p.apron.building[1] / 2 - 4;
  const bC = { x: c.x + nx * side * bOff, y: c.y + ny * side * bOff };
  const tOff = (off + halfW - p.apron.depth) / 2;
  const taxiway = {
    a: { x: c.x - d.x * half * 0.9 + nx * side * tOff, y: c.y - d.y * half * 0.9 + ny * side * tOff },
    b: { x: c.x + d.x * half * 0.9 + nx * side * tOff, y: c.y + d.y * half * 0.9 + ny * side * tOff },
    width: 22,
  };
  return {
    centre: c,
    dir: d,
    level: best.mean,
    field: rect(c, d, halfL, halfW),
    runways,
    terminal,
    apronRing: rect(apronC, d, p.apron.length / 2, p.apron.depth / 2),
    buildingRing: rect(bC, d, p.apron.building[0] / 2, p.apron.building[1] / 2),
    taxiway,
    spread: best.spread,
  };
}

/** Levels the terrain inside the airfield to `level`, blending over `blend` metres outside it. */
export function levelAirport(height: FieldGrid, a: AirportResult, blend: number): void {
  const halfL = Math.hypot(a.field[1]!.x - a.field[0]!.x, a.field[1]!.y - a.field[0]!.y) / 2;
  const halfW = Math.hypot(a.field[3]!.x - a.field[0]!.x, a.field[3]!.y - a.field[0]!.y) / 2;
  for (let gy = 0; gy < height.h; gy++) {
    for (let gx = 0; gx < height.w; gx++) {
      const x = (gx + 0.5) * height.cell - a.centre.x;
      const y = (gy + 0.5) * height.cell - a.centre.y;
      const u = Math.abs(x * a.dir.x + y * a.dir.y) - halfL;
      const v = Math.abs(-x * a.dir.y + y * a.dir.x) - halfW;
      const d = Math.max(u, v, 0);
      if (d >= blend) continue;
      const t = d / blend;
      const wgt = 1 - t * t * (3 - 2 * t);
      const i = gy * height.w + gx;
      height.data[i] = height.data[i]! + (a.level - height.data[i]!) * wgt;
    }
  }
}
