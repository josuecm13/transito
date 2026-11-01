import type { GamePlugin } from '../ecs/plugin.ts';
import type { Screen } from '../ui/screens.ts';
import type { MapView, Viewport, ZoomLimits } from '../sim/map-view.ts';
import { clampCenter, clampZoom, fitBounds, pan, zoomAt } from '../sim/map-view.ts';
import type { DetailLayer } from '../ui/world-map-canvas.ts';
import { createTitoPulse, drawWorldMap, WORLD_MAP_TITLE } from '../ui/world-map-canvas.ts';
import { renderStaticLayer } from '../ui/minimap-layer.ts';
import { sceneToSpec } from '../world/coords.ts';
import type { Vec2 } from '../world/vec.ts';
import { ScreensKey, WorldDataKey } from './keys.ts';

/** UI tuning, not world data. */
const DETAIL_M_PER_PX = 1;
const MIN_M_PER_PX = 0.5;
const FIT_PADDING_PX = 60;
/** Keyboard pan speed in screen px/s, so world speed scales with zoom. */
const PAN_PX_PER_S = 650;
const KEY_ZOOM_STEP = 2;
/** Exponential approach rate of the keyboard zoom tween (1/s). */
const ZOOM_EASE = 16;
const WHEEL_ZOOM_PER_PX = 0.0015;
const PAN_DIRS: Record<string, readonly [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [1, 0], ArrowLeft: [1, 0],
  KeyD: [-1, 0], ArrowRight: [-1, 0],
};
const ZOOM_KEYS: Record<string, number> = {
  Equal: KEY_ZOOM_STEP,
  NumpadAdd: KEY_ZOOM_STEP,
  Minus: 1 / KEY_ZOOM_STEP,
  NumpadSubtract: 1 / KEY_ZOOM_STEP,
};

export const worldMap: GamePlugin = {
  name: 'world-map',
  dependsOn: ['screens', 'world-data', 'player'],
  setup(ctx) {
    const screens = ctx.services.get(ScreensKey);
    const data = ctx.services.get(WorldDataKey);
    const players = ctx.ecs.with('player');
    const bounds = { minX: 0, minY: 0, maxX: data.spec.bounds.width, maxY: data.spec.bounds.height };

    let detail: DetailLayer | undefined;
    /** Live while mounted; `undefined` otherwise. */
    let session: { onKey(e: KeyboardEvent): boolean; close(): void } | undefined;

    const tito = (): { p: Vec2; yaw: number } | undefined => {
      const e = players.first;
      return e ? { p: sceneToSpec(e.position), yaw: e.yaw ?? 0 } : undefined;
    };

    function open(root: HTMLElement): typeof session {
      detail ??= { layer: renderStaticLayer(data, DETAIL_M_PER_PX), metersPerPx: DETAIL_M_PER_PX };
      const layer = detail;
      // Every listener below uses this signal: one abort() removes them all.
      const listeners = new AbortController();
      const { signal } = listeners;

      const host = document.createElement('div');
      host.id = 'world-map';
      host.setAttribute('aria-label', WORLD_MAP_TITLE);
      host.style.cssText = 'position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none;user-select:none';
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      host.append(canvas);
      root.append(host);
      const pulse = createTitoPulse(host);
      const g = canvas.getContext('2d');
      if (!g) throw new Error('world-map: 2D canvas unavailable');

      let vp: Viewport = { w: 1, h: 1 };
      let dpr = 1;
      let view: MapView = { center: { x: 0, y: 0 }, metersPerPx: 1 };
      let limits: ZoomLimits = { min: MIN_M_PER_PX, max: MIN_M_PER_PX };
      const held = new Set<string>();
      /** Pending keyboard zoom: target metersPerPx, eased toward around `anchor` (screen px). */
      let zoomTarget: { mpp: number; anchor: Vec2 } | undefined;

      const draw = (): void => {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        pulse.moveTo(drawWorldMap(g, { view, vp, player: tito() }, data, layer), vp);
      };
      const setView = (v: MapView): void => {
        view = clampCenter({ center: v.center, metersPerPx: clampZoom(v.metersPerPx, limits) }, bounds);
      };

      // Redraw on demand: every change calls invalidate(), which requests at most one animation
      // frame. The frame loop only continues while a pan key is held or a keyboard zoom eases.
      let raf = 0;
      let lastT = 0;
      const animating = (): boolean => zoomTarget !== undefined || [...held].some((c) => c in PAN_DIRS);
      const tick = (now: number): void => {
        raf = 0;
        const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
        lastT = now;
        let dx = 0;
        let dy = 0;
        for (const code of held) {
          const d = PAN_DIRS[code];
          if (d) {
            dx += d[0];
            dy += d[1];
          }
        }
        const len = Math.hypot(dx, dy);
        if (len > 0) setView(pan(view, (dx / len) * PAN_PX_PER_S * dt, (dy / len) * PAN_PX_PER_S * dt));
        if (zoomTarget) {
          const t = 1 - Math.exp(-ZOOM_EASE * dt);
          const next = Math.exp(Math.log(view.metersPerPx) + (Math.log(zoomTarget.mpp) - Math.log(view.metersPerPx)) * t);
          const done = Math.abs(Math.log(zoomTarget.mpp / next)) < 0.003;
          const mpp = done ? zoomTarget.mpp : next;
          setView(zoomAt(view, zoomTarget.anchor, view.metersPerPx / mpp, vp, limits));
          if (done) zoomTarget = undefined;
        }
        draw();
        if (animating()) raf = requestAnimationFrame(tick);
      };
      const invalidate = (): void => {
        if (raf === 0) {
          lastT = performance.now();
          raf = requestAnimationFrame(tick);
        }
      };

      const resize = (): void => {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, host.clientWidth || window.innerWidth);
        const h = Math.max(1, host.clientHeight || window.innerHeight);
        const first = vp.w === 1 && vp.h === 1;
        vp = { w, h };
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const fit = fitBounds(bounds, vp, FIT_PADDING_PX);
        limits = { min: MIN_M_PER_PX, max: Math.max(MIN_M_PER_PX, fit.metersPerPx) };
        setView(first ? fit : view);
        invalidate();
      };
      resize();

      const zoomCenter = (factor: number): void => {
        const from = zoomTarget?.mpp ?? view.metersPerPx;
        zoomTarget = { mpp: clampZoom(from / factor, limits), anchor: { x: vp.w / 2, y: vp.h / 2 } };
        invalidate();
      };
      const onKey = (e: KeyboardEvent): boolean => {
        if (e.code in PAN_DIRS) {
          held.add(e.code);
          invalidate();
          return true;
        }
        const z = ZOOM_KEYS[e.code];
        if (z !== undefined) {
          zoomCenter(z);
          return true;
        }
        if (e.code === 'KeyC') {
          const t = tito();
          if (t) {
            zoomTarget = undefined;
            setView({ center: t.p, metersPerPx: view.metersPerPx });
            invalidate();
          }
          return true;
        }
        return false; // Escape / Tab fall through to the screens service (back / toggle).
      };

      window.addEventListener('keyup', (e) => held.delete(e.code), { signal });
      window.addEventListener('blur', () => held.clear(), { signal });
      window.addEventListener('resize', resize, { signal });
      host.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * vp.h : e.deltaY;
          const r = canvas.getBoundingClientRect();
          zoomTarget = undefined;
          setView(zoomAt(view, { x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-px * WHEEL_ZOOM_PER_PX), vp, limits));
          invalidate();
        },
        { signal, passive: false },
      );
      let drag: { id: number; x: number; y: number } | undefined;
      host.addEventListener(
        'pointerdown',
        (e) => {
          if (e.button !== 0) return;
          drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
          host.setPointerCapture(e.pointerId);
          host.style.cursor = 'grabbing';
        },
        { signal },
      );
      host.addEventListener(
        'pointermove',
        (e) => {
          if (!drag || e.pointerId !== drag.id) return;
          setView(pan(view, e.clientX - drag.x, e.clientY - drag.y));
          drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
          invalidate();
        },
        { signal },
      );
      const endDrag = (): void => {
        drag = undefined;
        host.style.cursor = 'grab';
      };
      host.addEventListener('pointerup', endDrag, { signal });
      host.addEventListener('pointercancel', endDrag, { signal });
      host.addEventListener(
        'dblclick',
        (e) => {
          const r = canvas.getBoundingClientRect();
          zoomTarget = { mpp: clampZoom(view.metersPerPx / KEY_ZOOM_STEP, limits), anchor: { x: e.clientX - r.left, y: e.clientY - r.top } };
          invalidate();
        },
        { signal },
      );

      return {
        onKey,
        close() {
          listeners.abort();
          if (raf !== 0) cancelAnimationFrame(raf);
          raf = 0;
          held.clear();
          zoomTarget = undefined;
          pulse.remove();
          host.remove();
        },
      };
    }

    const screen: Screen = {
      id: 'world-map',
      title: WORLD_MAP_TITLE,
      mount(root) {
        session?.close();
        session = open(root);
      },
      unmount() {
        session?.close();
        session = undefined;
      },
      onKey: (e) => session?.onKey(e) ?? false,
    };

    screens.register(screen);
    screens.addMenuEntry({ label: WORLD_MAP_TITLE, order: 10, action: () => screens.open('world-map') });
    screens.addShortcut('Tab', 'world-map');
  },
};
