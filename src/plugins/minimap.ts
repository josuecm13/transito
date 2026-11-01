import type { GamePlugin } from '../ecs/plugin.ts';
import { WorldDataKey } from './keys.ts';
import { sceneToSpec } from '../world/coords.ts';
import { markerColor } from '../engine/meshes.ts';
import { clampToCircle, headingToMinimapAngle, worldToMinimap } from '../sim/minimap.ts';
import { MINIMAP_COLORS, renderStaticLayer } from '../ui/minimap-layer.ts';

/** UI tuning, not world data. `ranges` are view radii in meters (M toggles). */
const MINIMAP = { sizePx: 200, metersPerPxLayer: 1.5, ranges: [150, 400] as const };
const EDGE_MARGIN_PX = 8;
const DOT_RADIUS = 5;
const TITO_TEAL = '#14b8c4';

export const minimap: GamePlugin = {
  name: 'minimap',
  dependsOn: ['world-data', 'player'],
  setup(ctx) {
    const data = ctx.services.get(WorldDataKey);
    const layer = renderStaticLayer(data, MINIMAP.metersPerPxLayer);
    const size = MINIMAP.sizePx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const canvas = document.createElement('canvas');
    canvas.id = 'minimap';
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.cssText =
      `position:absolute;left:16px;bottom:16px;width:${size}px;height:${size}px;border-radius:50%;` +
      'border:3px solid #1a1d21;box-shadow:0 2px 8px rgba(0,0,0,.5);box-sizing:border-box;pointer-events:none';
    ctx.ui.append(canvas);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('minimap: 2D canvas unavailable');

    const players = ctx.ecs.with('player');
    let rangeIdx = 0;
    let mWasDown = false;

    ctx.addSystem({
      name: 'minimap',
      phase: 'render',
      run(c) {
        const down = c.input.isDown('KeyM');
        if (down && !mWasDown) rangeIdx = (rangeIdx + 1) % MINIMAP.ranges.length;
        mWasDown = down;

        const p = players.first;
        if (!p) return;
        const at = sceneToSpec(p.position);
        const radiusM = MINIMAP.ranges[rangeIdx] as number;
        const mPerPx = radiusM / (size / 2);
        const half = size / 2;

        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, size, size);
        g.save();
        g.beginPath();
        g.arc(half, half, half, 0, Math.PI * 2);
        g.clip();

        g.fillStyle = MINIMAP_COLORS.sea;
        g.fillRect(0, 0, size, size);
        const k = MINIMAP.metersPerPxLayer / mPerPx; // screen px per layer px
        const origin = layer.toLayer(at);
        g.imageSmoothingEnabled = true;
        g.drawImage(layer.canvas, half - origin.x * k, half - origin.y * k, layer.canvas.width * k, layer.canvas.height * k);

        for (const l of data.slice.landmarks) {
          const raw = worldToMinimap(l.position, at, mPerPx, size);
          const m = clampToCircle(raw, size, EDGE_MARGIN_PX);
          g.beginPath();
          g.arc(m.x, m.y, m.clamped ? DOT_RADIUS - 1.5 : DOT_RADIUS, 0, Math.PI * 2);
          g.fillStyle = `#${markerColor(l.kind).toString(16).padStart(6, '0')}`;
          g.fill();
          g.lineWidth = m.clamped ? 1.5 : 1;
          g.strokeStyle = m.clamped ? '#ffffff' : 'rgba(0,0,0,.6)';
          g.stroke();
        }

        g.save();
        g.translate(half, half);
        g.rotate(headingToMinimapAngle(p.yaw ?? 0));
        g.beginPath();
        g.moveTo(0, -9);
        g.lineTo(6, 7);
        g.lineTo(0, 3);
        g.lineTo(-6, 7);
        g.closePath();
        g.fillStyle = TITO_TEAL;
        g.fill();
        g.lineWidth = 2;
        g.lineJoin = 'round';
        g.strokeStyle = '#ffffff';
        g.stroke();
        g.restore();

        g.fillStyle = '#ffffff';
        g.font = '700 12px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.shadowColor = 'rgba(0,0,0,.8)';
        g.shadowBlur = 3;
        g.fillText('N', half, 4);
        g.restore();
      },
    });
  },
};
