import type { Disposable } from '../ecs/scope.ts';

/** The slice of three.js that teardown touches, so it can be tested with fakes. */
interface Disposer { dispose(): void }
export interface DisposableNode {
  geometry?: Disposer;
  material?: unknown;
  parent?: { remove(...o: never[]): unknown } | null;
  traverse(cb: (o: DisposableNode) => void): void;
}
export interface SceneLike {
  children: readonly DisposableNode[];
}

const isTexture = (v: unknown): v is Disposer =>
  typeof v === 'object' && v !== null && (v as { isTexture?: boolean }).isTexture === true;

function disposeMaterial(m: unknown): void {
  if (typeof m !== 'object' || m === null) return;
  for (const v of Object.values(m)) if (isTexture(v)) v.dispose();
  (m as Disposer).dispose();
}

/** Removes `obj` from its parent and disposes every geometry, material and material texture under it. */
export function disposeObject(scene: { remove(o: never): unknown }, obj: DisposableNode): void {
  scene.remove(obj as never);
  obj.traverse((o) => {
    o.geometry?.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) disposeMaterial(m);
  });
}

/**
 * Runs `build` (which adds to `scene`) and owns every child it added: on dispose each is removed from the
 * scene and its geometries, materials and textures are disposed. Children are owned even if `build` throws.
 */
export function ownSceneAdditions<S extends SceneLike & { remove(o: never): unknown }>(
  scene: S,
  own: (d: Disposable) => unknown,
  build: () => void,
): void {
  const before = new Set<unknown>(scene.children);
  try {
    build();
  } finally {
    for (const child of [...scene.children]) {
      if (!before.has(child)) own(() => disposeObject(scene, child));
    }
  }
}
