import {
  WebGPURenderer,
  Scene,
  Color,
  Fog,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
} from 'three/webgpu';

export interface View {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  backend: 'WebGPU' | 'WebGL2';
  render(): void;
  dispose(): void;
}

export async function createView(canvas: HTMLCanvasElement): Promise<View> {
  const renderer = new WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  // Stats cover exactly one view.render() (the renderer's own rAF would otherwise zero them before
  // the debug HUD reads them).
  renderer.info.autoReset = false;
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'WebGPU'
    : 'WebGL2';

  const sky = new Color(0x87ceeb);
  const scene = new Scene();
  scene.background = sky;
  scene.fog = new Fog(sky, 120, 350);

  const camera = new PerspectiveCamera(50, 1, 0.5, 2000);

  scene.add(new HemisphereLight(0xffffff, 0x556b2f, 1.2));
  const sun = new DirectionalLight(0xfff2d6, 2);
  sun.position.set(60, 100, 40);
  scene.add(sun);

  const resize = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    scene,
    camera,
    backend,
    render: () => {
      renderer.info.reset();
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
