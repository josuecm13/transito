import type { GamePlugin } from '../ecs/plugin.ts';
import { CameraControlKey, LandCoverKey, SectorHostKey, WorldDataKey } from './keys.ts';
import { sceneToSpec } from '../world/coords.ts';
import { markerColor } from '../engine/meshes.ts';
import { MAP_TIERS, mapTierAt } from '../sim/map-view.ts';
import { clampToCircle, headingToMinimapAngle, minimapOrientation, worldToMinimap } from '../sim/minimap.ts';
import { MINIMAP_COLORS, releaseSharedLayer, sharedStaticLayer } from '../ui/minimap-layer.ts';

/** UI tuning, not world data. `ranges` are view radii in meters (M toggles). */
const MINIMAP = { sizePx: 200, metersPerPxLayer: MAP_TIERS.m0.metersPerPx, ranges: [150, 400] as const };
const EDGE_MARGIN_PX = 8;
const DOT_RADIUS = 5;
const TITO_TEAL = '#14b8c4';

export const minimap: GamePlugin = {
  name: 'minimap',
  dependsOn: ['world-data', 'world-view', 'player', 'camera-settings'],
  setup(ctx) {
    const data = ctx.services.get(WorldDataKey);
    const camera = ctx.services.get(CameraControlKey);
    const cover = ctx.services.get(LandCoverKey);
    sharedStaticLayer(data, cover); // built up front, as before; looked up again every frame (see run)
    const sector = ctx.services.has(SectorHostKey) ? ctx.services.get(SectorHostKey) : undefined;
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

    // Light blur at the rim (doc 8.5): a blurred copy of the map, faded in from 60 % of the radius.
    // 200 px buffer, so it is cheap per frame. Landmarks, arrow and "N" are drawn after it, crisp.
    const rimBuf = document.createElement('canvas');
    rimBuf.width = canvas.width;
    rimBuf.height = canvas.height;
    const rg = rimBuf.getContext('2d');
    const softenRim = (radiusM: number, mPerPx: number): void => {
      if (!rg || !('filter' in rg)) return;
      const blur = mapTierAt(radiusM, mPerPx, radiusM * 0.4).blurPx;
      if (blur <= 0) return;
      rg.setTransform(1, 0, 0, 1, 0, 0);
      rg.globalCompositeOperation = 'copy';
      rg.filter = `blur(${blur * dpr}px)`;
      rg.drawImage(canvas, 0, 0);
      rg.filter = 'none';
      rg.globalCompositeOperation = 'destination-in';
      const c = rimBuf.width / 2;
      const fade = rg.createRadialGradient(c, c, c * 0.6, c, c, c);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, '#000');
      rg.fillStyle = fade;
      rg.fillRect(0, 0, rimBuf.width, rimBuf.height);
      rg.globalCompositeOperation = 'source-over';
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(rimBuf, 0, 0);
      g.restore();
    };

    // Teardown: out of the DOM, backing stores released (width/height = 0), shared layer forgotten.
    ctx.own(() => {
      canvas.remove();
      canvas.width = canvas.height = 0;
      rimBuf.width = rimBuf.height = 0;
      releaseSharedLayer(data);
    });

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
        if (sector?.state === 'unloaded') return; // the M0 layer is freed with the sector
        // Looked up every frame: a sector reload frees the shared layer and this rebuilds it on demand.
        const layer = sharedStaticLayer(data, cover);
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
        // Top-down: north up. Third-person: the camera's forward points up (yaw is 0 in top-down).
        const o = minimapOrientation(camera.chase ? camera.yaw : 0, p.yaw ?? 0);
        g.save();
        g.translate(half, half);
        g.rotate(o.mapAngle);
        g.translate(-half, -half);
        const k = MINIMAP.metersPerPxLayer / mPerPx; // screen px per layer px
        const origin = layer.toLayer(at);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(layer.canvas, half - origin.x * k, half - origin.y * k, layer.canvas.width * k, layer.canvas.height * k);
        softenRim(radiusM, mPerPx);

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
        g.restore();

        g.save();
        g.translate(half, half);
        g.rotate(camera.chase ? o.arrowAngle : headingToMinimapAngle(p.yaw ?? 0));
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
        // The "N" rides the rim at the bearing of north (top center when north is up).
        const rim = half - 10;
        g.fillText('N', half + Math.sin(o.northAngle) * rim, half - Math.cos(o.northAngle) * rim - 6);
        g.restore();
      },
    });
  },
};
