import type { WorldData } from '../world/world-data.ts';
import type { Vec2 } from '../world/vec.ts';
import { buildingCorners } from '../world/blockout.ts';
import { ribbon } from '../world/ribbon.ts';
import { AVENUE_KINDS } from '../world/streets/region.ts';
import { STREET_LAYERS } from '../world/street-surface.ts';
import type { StreetClass } from '../world/streets/planar-graph.ts';
import { courtRect } from '../world/court-layout.ts';

export const MINIMAP_COLORS = {
  sea: '#1d4e7a',
  land: '#7d8c72',
  block: '#8f8e7f',
  park: '#5f9a48',
  median: '#6f9452',
  court: '#b4573c',
  sidewalk: '#c9c9c0',
  street: { avenue: '#2c2f34', collector: '#383b40', local: '#44474c', alley: '#5d5952' } satisfies Record<StreetClass, string>,
  runway: '#a4a7ad',
  rail: '#5a4a40',
  waterway: '#3a86bd',
  asphalt: '#3a3d42',
  buildingResidential: '#cbc1ad',
  buildingCommercial: '#b3bcc6',
} as const;

/** Extra meters around `slice.rect` so the crop never shows an edge right at the border. */
export const LAYER_MARGIN_M = 100;
/** Thinnest street stroke (layer px), so alleys stay visible at coarse scales. */
const MIN_STREET_PX = 1;

export interface StaticLayer {
  canvas: HTMLCanvasElement;
  /** Layer pixel of a spec-plane point. */
  toLayer(p: Vec2): Vec2;
}

/**
 * The whole active area drawn once: sea, land, blocks (by land use), streets by class (sidewalk
 * band under the carriageway, real widths), parks / courts, buildings. Used by the minimap and the
 * world map's detail layer.
 */
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
   * Adds a ring to the current path, counter-clockwise on screen (clockwise for holes), so one
   * nonzero fill of many polygons is their union minus their holes. One fill per color instead of
   * one per polygon keeps the build fast (thousands of buildings).
   */
  const addRing = (pts: readonly Vec2[], hole = false): void => {
    if (pts.length < 3) return;
    const q = pts.map(toLayer);
    let area2 = 0;
    q.forEach((a, i) => {
      const b = q[(i + 1) % q.length] as Vec2;
      area2 += a.x * b.y - b.x * a.y;
    });
    if (area2 > 0 !== hole) q.reverse();
    q.forEach((a, i) => (i === 0 ? g.moveTo(a.x, a.y) : g.lineTo(a.x, a.y)));
    g.closePath();
  };
  type PolyLike = { outer: readonly Vec2[]; holes: readonly (readonly Vec2[])[] };
  const fillPolys = (polys: Iterable<PolyLike>, color: string): void => {
    g.beginPath();
    for (const p of polys) {
      addRing(p.outer);
      for (const hole of p.holes) addRing(hole, true);
    }
    g.fillStyle = color;
    g.fill();
  };
  const ring = (pts: readonly Vec2[]): PolyLike => ({ outer: pts, holes: [] });
  /** Ribbon triangle strip as quads. */
  function* strip(centerline: Vec2[], halfW: number): Generator<PolyLike> {
    const r = ribbon(centerline, halfW, halfW);
    for (let i = 0; i + 3 < r.positions.length; i += 2) {
      yield ring([r.positions[i] as Vec2, r.positions[i + 1] as Vec2, r.positions[i + 3] as Vec2, r.positions[i + 2] as Vec2]);
    }
  }

  g.fillStyle = MINIMAP_COLORS.sea;
  g.fillRect(0, 0, w, h);
  fillPolys([ring(data.spec.land)], MINIMAP_COLORS.land);

  // Blocks by land use (court blocks green with the court on top).
  const { streets, city } = data;
  const useOf = (block: number) => city.landUse[block]?.use ?? 'residential';
  const blockColor = (block: number): string =>
    useOf(block) === 'park' || useOf(block) === 'court' ? MINIMAP_COLORS.park : useOf(block) === 'median' ? MINIMAP_COLORS.median : MINIMAP_COLORS.block;
  for (const color of [MINIMAP_COLORS.block, MINIMAP_COLORS.park, MINIMAP_COLORS.median]) {
    fillPolys(
      streets.blocks.filter((b) => blockColor(b.id) === color).map((b) => ({ outer: b.ring, holes: b.holes })),
      color,
    );
  }
  const courtParts = city.landUse.filter((l) => l.use === 'court').flatMap((l) => city.buildable[l.block]?.parts ?? []);
  fillPolys(
    courtParts.map((p) => {
      const r = courtRect(p);
      return r ? ring(r) : p;
    }),
    MINIMAP_COLORS.court,
  );

  // Routes outside the street graph (runways, rails, canals).
  const surface: Record<string, string> = {
    runway: MINIMAP_COLORS.runway,
    rail: MINIMAP_COLORS.rail,
    waterway: MINIMAP_COLORS.waterway,
  };
  for (const s of data.slice.streets) {
    if (AVENUE_KINDS.has(s.kind)) continue; // avenues are graph edges
    fillPolys(strip(s.centerline, s.width / 2), surface[s.kind] ?? MINIMAP_COLORS.asphalt);
  }

  // Streets: one stroked path per layer, round caps and joins so junctions read clean.
  const edges = streets.graph.edges.filter((e) => e.cls !== 'frame');
  const node = (id: number) => toLayer(streets.graph.nodes[id] as Vec2);
  const strokeEdges = (list: typeof edges, widthM: (e: (typeof edges)[number]) => number, color: string): void => {
    const byWidth = new Map<number, typeof edges>();
    for (const e of list) {
      const px = Math.max(MIN_STREET_PX, widthM(e) / metersPerPx);
      const group = byWidth.get(px);
      if (group) group.push(e);
      else byWidth.set(px, [e]);
    }
    g.strokeStyle = color;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [px, group] of byWidth) {
      g.lineWidth = px;
      g.beginPath();
      for (const e of group) {
        const a = node(e.a);
        const b = node(e.b);
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
      }
      g.stroke();
    }
  };
  strokeEdges(
    edges.filter((e) => e.sidewalk > 0),
    (e) => e.width + 2 * e.sidewalk,
    MINIMAP_COLORS.sidewalk,
  );
  for (const cls of STREET_LAYERS) {
    strokeEdges(
      edges.filter((e) => e.cls === cls),
      (e) => e.width,
      MINIMAP_COLORS.street[cls],
    );
  }

  const commercial = (block: number) => useOf(block) === 'commercial';
  fillPolys(
    data.buildings.filter((b) => !commercial(b.block)).map((b) => ring(buildingCorners(b))),
    MINIMAP_COLORS.buildingResidential,
  );
  fillPolys(
    data.buildings.filter((b) => commercial(b.block)).map((b) => ring(buildingCorners(b))),
    MINIMAP_COLORS.buildingCommercial,
  );

  return { canvas, toLayer };
}
