import type { WorldData } from '../world/world-data.ts';
import type { Vec2 } from '../world/vec.ts';
import type { HeightGrid } from '../world/terrain.ts';
import type { Layer1Output } from '../world/layers/layer1-land-cover.ts';
import type { Layer3Output } from '../world/layers/layer3-water.ts';
import { hillshadeAt, pixelFrame, pixelToSpec, shadedCoverColor, specToPixel } from '../sim/map-layers.ts';
import type { PixelFrame, Rgb } from '../sim/map-layers.ts';

/** Water of the map screens (same blue as the minimap's waterways); the sea is MINIMAP_COLORS.sea. */
export const MAP_WATER = { fresh: '#3a86bd', chamber: '#6aa6cf', lockApron: '#a3a29c' } as const;
/** Thinnest river stroke (canvas px) so narrow headwaters stay visible at coarse scales. */
const MIN_RIVER_PX = 1;

type Rect = { minX: number; minY: number; maxX: number; maxY: number };
type Ctx = CanvasRenderingContext2D;

export interface BaseImage {
  canvas: HTMLCanvasElement;
  frame: PixelFrame;
}

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; g: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('map-base: 2D canvas unavailable');
  return { canvas, g };
}

/**
 * Land cover (and, with `relief`, hillshade) as an opaque image of `rect`, then clipped to `land` so
 * the sea stays transparent. Water-class cells are painted as forest first: the true coast is the land
 * polygon, not the 16 m cover cells.
 */
export function bakeCover(rect: Rect, metersPerPx: number, cover: Layer1Output, land: readonly (readonly Vec2[])[], relief?: HeightGrid): BaseImage {
  const frame = pixelFrame(rect, metersPerPx);
  const { canvas, g } = newCanvas(frame.w, frame.h);
  const img = g.createImageData(frame.w, frame.h);
  const px = img.data;
  const forest = cover.classes.indexOf('forest');
  for (let py = 0; py < frame.h; py++) {
    for (let ix = 0; ix < frame.w; ix++) {
      const p = pixelToSpec(frame, ix, py);
      const ci = Math.floor(p.x / cover.cellFar);
      const cj = Math.floor(p.y / cover.cellFar);
      const inGrid = ci >= 0 && cj >= 0 && ci < cover.cols && cj < cover.rows;
      const k = cj * cover.cols + ci;
      let cls = inGrid ? (cover.cover[k] as number) : forest;
      if (cover.classes[cls] === 'water') cls = forest;
      const density = inGrid ? (cover.density[k] as number) / 255 : 0.5;
      const shade = relief ? hillshadeAt(relief, p.x, p.y) : Math.SQRT1_2;
      const [r, gg, b] = shadedCoverColor(cover.classes[cls] as string, shade, density) as Rgb;
      const o = (py * frame.w + ix) * 4;
      px[o] = r;
      px[o + 1] = gg;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Keep only the land: destination-in with the land polygons.
  g.globalCompositeOperation = 'destination-in';
  g.beginPath();
  for (const ring of land) {
    ring.forEach((v, i) => {
      const q = specToPixel(frame, v.x, v.y);
      if (i === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    });
    g.closePath();
  }
  g.fillStyle = '#000';
  g.fill();
  g.globalCompositeOperation = 'source-over';
  return { canvas, frame };
}

/**
 * Layer 3 on a 2D canvas: rivers (real widths), lake / canal reaches / lock chambers (holes = islands),
 * lock aprons as grey marks. `toPx` maps spec to canvas pixels; `metersPerPx` is the canvas scale.
 */
export function paintWater(g: Ctx, toPx: (p: Vec2) => Vec2, metersPerPx: number, water: Layer3Output): void {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = MAP_WATER.fresh;
  for (const r of water.rivers) {
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = toPx(r.points[i] as Vec2);
      const b = toPx(r.points[i + 1] as Vec2);
      g.lineWidth = Math.max(MIN_RIVER_PX, (((r.width[i] as number) + (r.width[i + 1] as number)) / 2) / metersPerPx);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
  }
  const trace = (ring: readonly Vec2[]): void => {
    ring.forEach((v, i) => {
      const q = toPx(v);
      if (i === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    });
    g.closePath();
  };
  // Lock aprons under their chambers.
  g.fillStyle = MAP_WATER.lockApron;
  g.beginPath();
  for (const lock of water.locks) for (const c of lock.chambers) trace(c.apron);
  g.fill();
  for (const [kinds, color] of [[['lake', 'canal'], MAP_WATER.fresh], [['chamber'], MAP_WATER.chamber]] as const) {
    g.beginPath();
    for (const w of water.water) {
      if (!(kinds as readonly string[]).includes(w.kind)) continue;
      trace(w.ring);
      for (const h of w.holes) trace(h);
    }
    g.fillStyle = color;
    g.fill('evenodd');
  }
  g.restore();
}

/**
 * The whole isthmus drawn once (`rect`, usually the map bounds): land cover with hillshade, then the
 * layer 3 water. The sea is transparent so the caller's sea / shallows show through.
 */
export function bakeIsthmusBase(data: WorldData, cover: Layer1Output, rect: Rect, metersPerPx: number): BaseImage {
  const land = [data.spec.land, ...data.spec.islands.map((i) => i.points)];
  const base = bakeCover(rect, metersPerPx, cover, land, data.terrain.farGrid);
  const g = base.canvas.getContext('2d') as Ctx;
  g.save();
  // Water only on land (the lake, canal and rivers never reach the sea polygon-wise, but river mouths may overhang the coast).
  g.beginPath();
  for (const ring of land) {
    ring.forEach((v, i) => {
      const q = specToPixel(base.frame, v.x, v.y);
      if (i === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    });
    g.closePath();
  }
  g.clip();
  paintWater(g, (p) => specToPixel(base.frame, p.x, p.y), metersPerPx, data.water);
  g.restore();
  return base;
}
