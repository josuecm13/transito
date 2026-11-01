import type { WorldData } from '../world/world-data.ts';
import type { Vec2 } from '../world/vec.ts';
import { buildingCorners } from '../world/blockout.ts';
import { ribbon } from '../world/ribbon.ts';

export const MINIMAP_COLORS = {
  sea: '#1d4e7a',
  land: '#7d8c72',
  asphalt: '#3a3d42',
  sidewalk: '#c9c9c0',
  runway: '#a4a7ad',
  rail: '#5a4a40',
  waterway: '#3a86bd',
  building: '#b0a99a',
} as const;

/** Extra meters around `slice.rect` so the crop never shows an edge right at the border. */
export const LAYER_MARGIN_M = 100;

export interface StaticLayer {
  canvas: HTMLCanvasElement;
  /** Layer pixel of a spec-plane point. */
  toLayer(p: Vec2): Vec2;
}

export function renderStaticLayer(data: WorldData, metersPerPx: number): StaticLayer {
  const { rect } = data.slice;
  const minX = rect.minX - LAYER_MARGIN_M;
  const maxY = rect.maxY + LAYER_MARGIN_M;
  const w = Math.ceil((rect.maxX - rect.minX + 2 * LAYER_MARGIN_M) / metersPerPx);
  const h = Math.ceil((rect.maxY - rect.minY + 2 * LAYER_MARGIN_M) / metersPerPx);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('minimap: 2D canvas unavailable');

  const toLayer = (p: Vec2): Vec2 => ({ x: (p.x - minX) / metersPerPx, y: (maxY - p.y) / metersPerPx });
  /**
   * Adds a polygon to the current path, always counter-clockwise on screen, so one nonzero
   * fill of many polygons is their union (no holes where neighbours overlap). One fill per
   * color instead of one per polygon keeps the build fast (thousands of buildings).
   */
  const addPoly = (pts: readonly Vec2[]): void => {
    if (pts.length < 3) return;
    const q = pts.map(toLayer);
    let area2 = 0;
    q.forEach((a, i) => {
      const b = q[(i + 1) % q.length] as Vec2;
      area2 += a.x * b.y - b.x * a.y;
    });
    if (area2 > 0) q.reverse();
    q.forEach((a, i) => (i === 0 ? g.moveTo(a.x, a.y) : g.lineTo(a.x, a.y)));
    g.closePath();
  };
  const fillPolys = (polys: Iterable<readonly Vec2[]>, color: string): void => {
    g.beginPath();
    for (const p of polys) addPoly(p);
    g.fillStyle = color;
    g.fill();
  };
  /** Ribbon triangle strip as quads. */
  function* strip(centerline: Vec2[], halfW: number): Generator<Vec2[]> {
    const r = ribbon(centerline, halfW, halfW);
    for (let i = 0; i + 3 < r.positions.length; i += 2) {
      yield [r.positions[i] as Vec2, r.positions[i + 1] as Vec2, r.positions[i + 3] as Vec2, r.positions[i + 2] as Vec2];
    }
  }

  g.fillStyle = MINIMAP_COLORS.sea;
  g.fillRect(0, 0, w, h);
  fillPolys([data.spec.land], MINIMAP_COLORS.land);

  const surface: Record<string, string> = {
    runway: MINIMAP_COLORS.runway,
    rail: MINIMAP_COLORS.rail,
    waterway: MINIMAP_COLORS.waterway,
  };
  // Sidewalks first, then carriageways on top, so crossings read as clean intersections.
  fillPolys(
    data.slice.streets.filter((s) => s.sidewalk > 0).flatMap((s) => [...strip(s.centerline, s.width / 2 + s.sidewalk)]),
    MINIMAP_COLORS.sidewalk,
  );
  const byColor = new Map<string, Vec2[][]>();
  for (const s of data.slice.streets) {
    const color = surface[s.kind] ?? MINIMAP_COLORS.asphalt;
    const list = byColor.get(color) ?? [];
    list.push(...strip(s.centerline, s.width / 2));
    byColor.set(color, list);
  }
  for (const [color, quads] of byColor) fillPolys(quads, color);
  fillPolys(
    data.buildings.map((b) => buildingCorners(b)),
    MINIMAP_COLORS.building,
  );

  return { canvas, toLayer };
}
