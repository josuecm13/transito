import type { WorldData } from '../world/world-data.ts';
import { districtLabelPoint } from '../world/spec.ts';
import type { Rect } from '../world/geometry.ts';
import type { Vec2 } from '../world/vec.ts';
import type { MapView, Viewport } from '../sim/map-view.ts';
import { niceScaleLength, placeLabels, worldToScreen } from '../sim/map-view.ts';
import { headingToMinimapAngle } from '../sim/minimap.ts';
import { markerColor } from '../engine/meshes.ts';
import type { StaticLayer } from './minimap-layer.ts';
import { MINIMAP_COLORS } from './minimap-layer.ts';

export const WORLD_MAP_HINT = 'Mover: WASD/flechas o arrastrar · Zoom: rueda o +/− · Centrar en Tito: C · Volver: Esc/Tab';
export const WORLD_MAP_TITLE = 'Mapa';
export const TITO_TEAL = '#14b8c4';

/** Visual tuning (UI, not world data). The sea matches the minimap layer so the detail blends in. */
const C = {
  sea: MINIMAP_COLORS.sea,
  shallows: 'rgba(140,195,230,.16)',
  land: '#56614f',
  coast: '#9aab90',
  beyond: 'rgba(16,20,16,.30)',
  boundary: 'rgba(240,228,196,.55)',
  activeOutline: 'rgba(255,244,214,.9)',
  ink: '#f4ead2',
  inkSoft: '#d8cfb6',
  halo: 'rgba(16,22,18,.88)',
  water: '#a9cdea',
  waterHalo: 'rgba(10,32,54,.75)',
  panel: 'rgba(12,16,20,.72)',
  panelEdge: 'rgba(255,255,255,.14)',
} as const;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const FOOTER_H = 34;
/** How far (m) the land skirt past the west/east box edge fades into the sea. */
const SKIRT_FADE_M = 700;

/** Level of detail, in meters per screen pixel. */
const LOD = {
  /** District sub-labels only when closer than this. */
  subLabelMaxMpp: 7,
  /** Landmark names only when closer than this (dots are always drawn). */
  landmarkLabelMaxMpp: 5,
};

/** Spanish legend names for marker kinds; unknown kinds show the raw kind. */
const KIND_LABEL: Record<string, string> = {
  residential: 'Vivienda',
  commercial: 'Comercio',
  transit: 'Transporte',
  industrial: 'Industria',
  other: 'Lugar',
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
/** '#rrggbb' -> 'rgba(r,g,b,a)'. */
const withAlpha = (h: string, a: number): string =>
  `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;

export interface DetailLayer {
  layer: StaticLayer;
  /** Meters per layer pixel the layer was rendered at. */
  metersPerPx: number;
}

export interface WorldMapFrame {
  view: MapView;
  vp: Viewport;
  player: { p: Vec2; yaw: number } | undefined;
}

type Ctx = CanvasRenderingContext2D;

function tracePath(g: Ctx, pts: readonly Vec2[], toS: (p: Vec2) => Vec2, close: boolean): void {
  pts.forEach((p, i) => {
    const q = toS(p);
    if (i === 0) g.moveTo(q.x, q.y);
    else g.lineTo(q.x, q.y);
  });
  if (close) g.closePath();
}

function setFont(g: Ctx, font: string, spacing = 0): void {
  g.font = font;
  g.letterSpacing = `${spacing}px`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
}

/** Text with a round halo, left edge at x, vertically centered on y. */
function haloText(g: Ctx, s: string, x: number, y: number, fill: string, halo: string, haloW = 3.5): void {
  g.lineJoin = 'round';
  g.lineWidth = haloW;
  g.strokeStyle = halo;
  g.strokeText(s, x, y);
  g.fillStyle = fill;
  g.fillText(s, x, y);
}

let hatch: CanvasPattern | null | undefined;
function hatchPattern(g: Ctx): CanvasPattern | null {
  if (hatch !== undefined) return hatch;
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const h = c.getContext('2d');
  if (h) {
    h.strokeStyle = 'rgba(0,0,0,.28)';
    h.lineWidth = 1;
    h.beginPath();
    h.moveTo(0, 8);
    h.lineTo(8, 0);
    h.stroke();
  }
  hatch = g.createPattern(c, 'repeat');
  return hatch;
}

/** Tito's arrow (same silhouette as the minimap's, a bit larger) with a soft halo. */
function drawTito(g: Ctx, at: Vec2, yaw: number): void {
  const halo = g.createRadialGradient(at.x, at.y, 0, at.x, at.y, 28);
  halo.addColorStop(0, 'rgba(20,184,196,.55)');
  halo.addColorStop(1, 'rgba(20,184,196,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(at.x, at.y, 28, 0, Math.PI * 2);
  g.fill();

  g.save();
  g.translate(at.x, at.y);
  g.rotate(headingToMinimapAngle(yaw));
  g.beginPath();
  g.moveTo(0, -12);
  g.lineTo(8, 9);
  g.lineTo(0, 4.5);
  g.lineTo(-8, 9);
  g.closePath();
  g.shadowColor = 'rgba(0,0,0,.6)';
  g.shadowBlur = 4;
  g.fillStyle = TITO_TEAL;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.restore();
}

function panel(g: Ctx, x: number, y: number, w: number, h: number, r = 8): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = C.panel;
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = C.panelEdge;
  g.stroke();
}

interface LabelOption {
  box: Rect;
  draw: () => void;
}

/**
 * Draws the full-screen world map. Outside the active area only the land silhouette, the
 * playable boundary and spec names are drawn; landmarks come exclusively from
 * `data.slice.landmarks` (the active area), so other acts' places are never revealed.
 * Returns Tito's screen position (for the pulse overlay), if there is a player.
 */
export function drawWorldMap(g: Ctx, frame: WorldMapFrame, data: WorldData, detail: DetailLayer): Vec2 | undefined {
  const { view, vp, player } = frame;
  const { spec, slice } = data;
  const mpp = view.metersPerPx;
  const toS = (p: Vec2): Vec2 => worldToScreen(view, p, vp);

  // --- Sea.
  g.setLineDash([]);
  g.fillStyle = C.sea;
  g.fillRect(0, 0, vp.w, vp.h);

  const width = spec.bounds.width;
  const landShapes: Vec2[][] = [spec.land, ...spec.islands.map((i) => i.points)];
  const landPath = (): void => {
    g.beginPath();
    for (const s of landShapes) tracePath(g, s, toS, true);
  };
  // Land running along the west/east box edge is not coast: the isthmus continues past it.
  const onSideEdge = (a: Vec2, b: Vec2): boolean => (a.x <= 0 && b.x <= 0) || (a.x >= width && b.x >= width);
  const coastPath = (): void => {
    g.beginPath();
    for (const shape of landShapes) {
      shape.forEach((a, i) => {
        const b = shape[(i + 1) % shape.length] as Vec2;
        if (onSideEdge(a, b)) return;
        const qa = toS(a);
        const qb = toS(b);
        g.moveTo(qa.x, qa.y);
        g.lineTo(qb.x, qb.y);
      });
    }
  };

  // --- Shallows: wide soft strokes along the coast read as a coastal shelf.
  const shallows = (): void => {
    coastPath();
    g.lineJoin = 'round';
    for (const [meters, minPx] of [[220, 10], [110, 5]] as const) {
      g.lineWidth = Math.min(28, Math.max(minPx, meters / mpp));
      g.strokeStyle = C.shallows;
      g.stroke();
    }
  };
  shallows();

  // --- Land (muted greybox) and the area beyond the playable boundary (shaded + hatched).
  landPath();
  g.fillStyle = C.land;
  g.fill();
  const origin = toS({ x: 0, y: 0 });
  const pattern = hatchPattern(g);
  pattern?.setTransform(new DOMMatrix().translate(origin.x, origin.y));

  // --- Land skirts past the west/east box edges: same unplayable look, fading into the sea,
  // so the map reads as a strip cut from a longer isthmus rather than an island.
  for (const [edgeX, dir] of [[0, -1], [width, 1]] as const) {
    const ys = spec.land.filter((p) => p.x === edgeX).map((p) => p.y);
    if (ys.length < 2) continue;
    const a = toS({ x: edgeX, y: Math.max(...ys) });
    const b = toS({ x: edgeX + dir * SKIRT_FADE_M, y: Math.min(...ys) });
    const x0 = Math.min(a.x, b.x);
    const w = Math.abs(b.x - a.x);
    g.fillStyle = C.land;
    g.fillRect(x0, a.y, w, b.y - a.y);
    g.fillStyle = C.beyond;
    g.fillRect(x0, a.y, w, b.y - a.y);
    if (pattern) {
      g.fillStyle = pattern;
      g.fillRect(x0, a.y, w, b.y - a.y);
    }
    const fade = g.createLinearGradient(a.x, 0, b.x, 0);
    fade.addColorStop(0, withAlpha(C.sea, 0));
    fade.addColorStop(1, C.sea);
    g.fillStyle = fade;
    g.fillRect(x0, a.y, w + 1, b.y - a.y);
  }

  // --- Active area in detail (cached layer placed at its world position, clipped to slice.rect).
  const r = slice.rect;
  const nw = toS({ x: r.minX, y: r.maxY });
  const se = toS({ x: r.maxX, y: r.minY });
  const k = detail.metersPerPx / mpp; // screen px per layer px
  const lo = detail.layer.toLayer({ x: r.minX, y: r.maxY });
  g.save();
  g.beginPath();
  g.rect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
  g.clip();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(detail.layer.canvas, nw.x - lo.x * k, nw.y - lo.y * k, detail.layer.canvas.width * k, detail.layer.canvas.height * k);
  // The detail covered the shallows inside the rect: redraw them there, on the sea side only.
  g.beginPath();
  g.rect(0, 0, vp.w, vp.h);
  for (const s of landShapes) tracePath(g, s, toS, true);
  g.clip('evenodd');
  shallows();
  g.restore();

  // --- Beyond the playable boundary: shaded + hatched, over the detail too.
  g.save();
  landPath();
  g.clip();
  for (const side of [spec.playableBoundary.west, spec.playableBoundary.east]) {
    g.beginPath();
    tracePath(g, side, toS, true);
    g.fillStyle = C.beyond;
    g.fill();
    if (pattern) {
      g.fillStyle = pattern;
      g.fill();
    }
  }
  g.restore();

  // --- Coastline and playable boundary on top, so they stay continuous across the detail.
  coastPath();
  g.lineWidth = 1;
  g.strokeStyle = C.coast;
  g.stroke();
  g.setLineDash([6, 5]);
  g.lineWidth = 1.25;
  g.strokeStyle = C.boundary;
  for (const side of [spec.playableBoundary.west, spec.playableBoundary.east]) {
    g.beginPath();
    tracePath(g, side, toS, false);
    g.stroke();
  }
  g.setLineDash([]);

  // Vignette over the whole cartography (not the chrome).
  const vig = g.createRadialGradient(vp.w / 2, vp.h / 2, Math.min(vp.w, vp.h) * 0.4, vp.w / 2, vp.h / 2, Math.hypot(vp.w, vp.h) * 0.62);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,.32)');
  g.fillStyle = vig;
  g.fillRect(0, 0, vp.w, vp.h);

  // Active-area outline: dark under-stroke + light line.
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,.45)';
  g.strokeRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
  g.lineWidth = 1.25;
  g.strokeStyle = C.activeOutline;
  g.strokeRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);

  // --- Chrome (title, compass, scale, legend, footer): laid out first so labels avoid it.
  const chrome = layoutChrome(g, vp, mpp, data);
  const reserved: Rect[] = [...chrome.reserved];

  // --- Landmark dots (active slice only).
  const dots = slice.landmarks.map((l) => ({ l, s: toS(l.position) }));
  for (const { l, s } of dots) {
    g.beginPath();
    g.arc(s.x, s.y, 5.5, 0, Math.PI * 2);
    g.fillStyle = hex(markerColor(l.kind));
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.beginPath();
    g.arc(s.x, s.y, 7, 0, Math.PI * 2);
    g.stroke();
    reserved.push({ minX: s.x - 8, minY: s.y - 8, maxX: s.x + 8, maxY: s.y + 8 });
  }

  // --- Tito.
  let tito: Vec2 | undefined;
  if (player) {
    tito = toS(player.p);
    drawTito(g, tito, player.yaw);
    reserved.push({ minX: tito.x - 14, minY: tito.y - 14, maxX: tito.x + 14, maxY: tito.y + 14 });
  }

  // --- Labels: collect options, place greedily by priority, draw the winners.
  const candidates: { priority: number; options: LabelOption[] }[] = [];
  const boxAround = (x: number, y: number, w: number, h: number): Rect => ({ minX: x - 2, minY: y - h / 2 - 1, maxX: x + w + 2, maxY: y + h / 2 + 1 });

  const NAME_FONT = `700 13px ${FONT}`;
  const SUB_FONT = `italic 500 11px ${FONT}`;
  const WATER_FONT = `italic 600 13px ${FONT}`;
  const showSub = mpp <= LOD.subLabelMaxMpp;
  for (const d of spec.districts) {
    const at = districtLabelPoint(spec, d);
    if (!at) continue;
    const p = toS(at);
    // Water districts (the lake) are lettered like water bodies.
    const water = d.playable === 'water';
    const font = water ? WATER_FONT : NAME_FONT;
    const spacing = water ? 1.4 : 1.6;
    const name = water ? d.name : d.name.toLocaleUpperCase('es');
    setFont(g, font, spacing);
    const nw2 = g.measureText(name).width;
    const nameX = p.x - nw2 / 2;
    const drawName = (y: number) => (): void => {
      setFont(g, font, spacing);
      haloText(g, name, nameX, y, water ? C.water : C.ink, C.halo);
    };
    const options: LabelOption[] = [];
    if (showSub && d.sub) {
      const sub = d.sub;
      setFont(g, SUB_FONT, 0.2);
      const sw = g.measureText(sub).width;
      const w = Math.max(nw2, sw);
      options.push({
        box: { minX: p.x - w / 2 - 2, minY: p.y - 9, maxX: p.x + w / 2 + 2, maxY: p.y + 23 },
        draw: () => {
          drawName(p.y)();
          setFont(g, SUB_FONT, 0.2);
          haloText(g, sub, p.x - sw / 2, p.y + 15, C.inkSoft, C.halo, 3);
        },
      });
    }
    options.push({ box: boxAround(nameX, p.y, nw2, 16), draw: drawName(p.y) });
    candidates.push({ priority: 90, options });
  }

  for (const w of spec.waterLabels) {
    const p = toS(w.at);
    setFont(g, WATER_FONT, 1.4);
    const ww = g.measureText(w.name).width;
    const x = p.x - ww / 2;
    candidates.push({
      priority: 60,
      options: [{ box: boxAround(x, p.y, ww, 16), draw: () => {
        setFont(g, WATER_FONT, 1.4);
        haloText(g, w.name, x, p.y, C.water, C.waterHalo, 3);
      } }],
    });
  }

  if (mpp <= LOD.landmarkLabelMaxMpp) {
    const LM_FONT = `600 12px ${FONT}`;
    for (const { l, s } of dots) {
      const label = l.displayName ?? l.id;
      setFont(g, LM_FONT, 0.2);
      const lw = g.measureText(label).width;
      const at = (x: number, y: number): LabelOption => ({
        box: boxAround(x, y, lw, 15),
        draw: () => {
          setFont(g, LM_FONT, 0.2);
          haloText(g, label, x, y, '#ffffff', C.halo, 3.5);
        },
      });
      candidates.push({
        priority: l.displayName ? 95 : 80,
        // Right, left, above, below; then the same pushed out (e.g. when Tito stands on the dot).
        options: [11, 20].flatMap((d) => [
          at(s.x + d, s.y),
          at(s.x - d - lw, s.y),
          at(s.x - lw / 2, s.y - d - 5),
          at(s.x - lw / 2, s.y + d + 5),
        ]),
      });
    }
  }

  const chosen = placeLabels(
    candidates.map((c) => ({ priority: c.priority, boxes: c.options.map((o) => o.box) })),
    reserved,
    vp,
  );
  chosen.forEach((idx, i) => {
    if (idx >= 0) candidates[i]?.options[idx]?.draw();
  });

  chrome.draw();
  return tito;
}

function layoutChrome(g: Ctx, vp: Viewport, mpp: number, data: WorldData): { reserved: Rect[]; draw(): void } {
  const titleW = 132;
  const titleBox = { minX: vp.w / 2 - titleW / 2, minY: 14, maxX: vp.w / 2 + titleW / 2, maxY: 52 };
  const compass = { x: vp.w - 46, y: 50, r: 24 };
  const compassBox = { minX: compass.x - compass.r - 4, minY: compass.y - compass.r - 4, maxX: compass.x + compass.r + 4, maxY: compass.y + compass.r + 16 };
  const footerBox = { minX: 0, minY: vp.h - FOOTER_H, maxX: vp.w, maxY: vp.h };

  // Scale bar: 1-2-5 length that fits in ~160 px.
  const meters = niceScaleLength(160 * mpp);
  const len = meters / mpp;
  const sx = 24;
  const sy = vp.h - FOOTER_H - 24;
  const scaleBox = { minX: sx - 12, minY: sy - 30, maxX: sx - 12 + len + 64, maxY: sy + 16 };

  // Legend.
  const kinds = [...new Set(data.slice.landmarks.map((l) => l.kind))];
  const rows: { label: string; icon: (x: number, y: number) => void }[] = [
    { label: 'Tito', icon: (x, y) => {
      g.save();
      g.translate(x, y);
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 6);
      g.lineTo(0, 3);
      g.lineTo(-5, 6);
      g.closePath();
      g.fillStyle = TITO_TEAL;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = '#fff';
      g.stroke();
      g.restore();
    } },
    { label: 'Área activa', icon: (x, y) => {
      g.lineWidth = 1.25;
      g.strokeStyle = C.activeOutline;
      g.strokeRect(x - 7, y - 5, 14, 10);
    } },
    { label: 'Límite transitable', icon: (x, y) => {
      g.setLineDash([4, 3]);
      g.lineWidth = 1.5;
      g.strokeStyle = C.boundary;
      g.beginPath();
      g.moveTo(x - 8, y);
      g.lineTo(x + 8, y);
      g.stroke();
      g.setLineDash([]);
    } },
    ...kinds.map((kind) => ({ label: KIND_LABEL[kind] ?? kind, icon: (x: number, y: number) => {
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.fillStyle = hex(markerColor(kind));
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = '#fff';
      g.stroke();
    } })),
  ];
  setFont(g, `500 12px ${FONT}`);
  const rowH = 20;
  const lw = 34 + Math.max(...rows.map((r) => g.measureText(r.label).width)) + 14;
  const lh = 30 + rows.length * rowH;
  const lx = vp.w - lw - 16;
  const ly = vp.h - FOOTER_H - lh - 14;
  const legendBox = { minX: lx, minY: ly, maxX: lx + lw, maxY: ly + lh };

  const draw = (): void => {
    // Title.
    panel(g, titleBox.minX, titleBox.minY, titleBox.maxX - titleBox.minX, titleBox.maxY - titleBox.minY, 19);
    setFont(g, `700 20px ${FONT}`, 3);
    g.textAlign = 'center';
    g.fillStyle = C.ink;
    g.fillText(WORLD_MAP_TITLE.toLocaleUpperCase('es'), vp.w / 2 + 1.5, (titleBox.minY + titleBox.maxY) / 2 + 1);

    // Compass: north needle (cream) / south needle (dark), "N" above.
    g.beginPath();
    g.arc(compass.x, compass.y, compass.r, 0, Math.PI * 2);
    g.fillStyle = C.panel;
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = C.panelEdge;
    g.stroke();
    const n = compass.r - 7;
    g.beginPath();
    g.moveTo(compass.x, compass.y - n);
    g.lineTo(compass.x + 5, compass.y);
    g.lineTo(compass.x - 5, compass.y);
    g.closePath();
    g.fillStyle = '#e8574a';
    g.fill();
    g.beginPath();
    g.moveTo(compass.x, compass.y + n);
    g.lineTo(compass.x + 5, compass.y);
    g.lineTo(compass.x - 5, compass.y);
    g.closePath();
    g.fillStyle = C.inkSoft;
    g.fill();
    setFont(g, `800 12px ${FONT}`);
    g.textAlign = 'center';
    haloText(g, 'N', compass.x, compass.y + compass.r + 9, C.ink, C.halo, 3);

    // Scale bar: alternating segments.
    panel(g, scaleBox.minX, scaleBox.minY, scaleBox.maxX - scaleBox.minX, scaleBox.maxY - scaleBox.minY, 8);
    const halves = 4;
    for (let i = 0; i < halves; i++) {
      g.fillStyle = i % 2 === 0 ? C.ink : '#2a2f33';
      g.fillRect(sx + (len / halves) * i, sy, len / halves, 5);
    }
    g.lineWidth = 1;
    g.strokeStyle = C.ink;
    g.strokeRect(sx, sy, len, 5);
    setFont(g, `600 12px ${FONT}`);
    g.fillStyle = C.ink;
    g.textAlign = 'left';
    g.fillText('0', sx - 3, sy - 12);
    g.textAlign = 'center';
    g.fillText(meters >= 1000 ? `${meters / 1000} km` : `${meters} m`, sx + len, sy - 12);

    // Legend.
    panel(g, lx, ly, lw, lh, 8);
    setFont(g, `700 11px ${FONT}`, 1.5);
    g.fillStyle = C.inkSoft;
    g.fillText('LEYENDA', lx + 14, ly + 16);
    rows.forEach((row, i) => {
      const y = ly + 34 + i * rowH;
      row.icon(lx + 22, y);
      setFont(g, `500 12px ${FONT}`);
      g.fillStyle = C.ink;
      g.fillText(row.label, lx + 38, y);
    });

    // Footer hint.
    g.fillStyle = 'rgba(8,10,12,.82)';
    g.fillRect(0, vp.h - FOOTER_H, vp.w, FOOTER_H);
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.fillRect(0, vp.h - FOOTER_H, vp.w, 1);
    setFont(g, `500 13px ${FONT}`, 0.2);
    g.textAlign = 'center';
    g.fillStyle = '#e9e6dc';
    g.fillText(WORLD_MAP_HINT, vp.w / 2, vp.h - FOOTER_H / 2);
  };

  const pad = (b: Rect): Rect => ({ minX: b.minX - 4, minY: b.minY - 4, maxX: b.maxX + 4, maxY: b.maxY + 4 });
  return { reserved: [titleBox, compassBox, footerBox, scaleBox, legendBox].map(pad), draw };
}

/**
 * Animated ring around Tito, done with the Web Animations API on a DOM element so the map
 * canvas itself only redraws on demand (no rAF just for the pulse).
 */
export function createTitoPulse(parent: HTMLElement): { moveTo(p: Vec2 | undefined, vp: Viewport): void; remove(): void } {
  const ring = document.createElement('div');
  ring.style.cssText =
    'position:absolute;left:0;top:0;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;' +
    `border:3px solid ${TITO_TEAL};box-shadow:0 0 0 1.5px rgba(255,255,255,.85),inset 0 0 0 1px rgba(255,255,255,.6);` +
    'box-sizing:border-box;pointer-events:none;will-change:transform,opacity';
  parent.append(ring);
  const anim = ring.animate(
    [
      { transform: 'scale(.8)', opacity: 1 },
      { transform: 'scale(2.2)', opacity: 0 },
    ],
    { duration: 1600, iterations: Infinity, easing: 'ease-out' },
  );
  return {
    moveTo(p, vp) {
      const visible = p !== undefined && p.x > -20 && p.y > -20 && p.x < vp.w + 20 && p.y < vp.h + 20;
      ring.style.display = visible ? 'block' : 'none';
      if (p) ring.style.translate = `${p.x}px ${p.y}px`;
    },
    remove() {
      anim.cancel();
      ring.remove();
    },
  };
}
