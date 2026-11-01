import type { Camera } from 'three/webgpu';
import { Vector3 } from 'three/webgpu';

export interface WorldLabel {
  text: string;
  /** Scene-space anchor (top of the marker). */
  position: { x: number; y: number; z: number };
}

const MAX_DISTANCE = 300;

/** DOM labels pinned to scene points. Call update() once per frame, after the camera moved. */
export function createWorldLabels(
  parent: HTMLElement,
  camera: Camera,
  labels: readonly WorldLabel[],
): { update(): void } {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
  parent.append(layer);
  const items = labels.map((l) => {
    const el = document.createElement('div');
    el.textContent = l.text;
    el.style.cssText =
      'position:absolute;left:0;top:0;display:none;transform:translate(-50%,-100%);' +
      'padding:1px 5px;background:rgba(0,0,0,.6);color:#fff;font:11px monospace;white-space:nowrap';
    layer.append(el);
    return { el, anchor: new Vector3(l.position.x, l.position.y, l.position.z) };
  });
  const v = new Vector3();
  return {
    update() {
      camera.updateMatrixWorld();
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (const it of items) {
        const far = camera.position.distanceTo(it.anchor) > MAX_DISTANCE;
        v.copy(it.anchor).project(camera);
        const hidden = far || v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1;
        if (hidden) {
          it.el.style.display = 'none';
          continue;
        }
        it.el.style.display = 'block';
        it.el.style.transform = `translate(${((v.x + 1) / 2) * w}px,${((1 - v.y) / 2) * h}px) translate(-50%,-100%)`;
      }
    },
  };
}
