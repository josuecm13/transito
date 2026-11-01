import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three/webgpu';
import type { Vec2 } from '../world/vec.ts';
import type { Building } from '../world/blockout.ts';
import { specAngleToSceneYaw, specToScene } from '../world/coords.ts';

export const PALETTE = {
  land: 0x6b7a66,
  sea: 0x1d4e7a,
  asphalt: 0x2f3236,
  sidewalk: 0xb9b9b2,
  runway: 0x7d8086,
  rail: 0x4a4038,
  waterway: 0x2a6a9a,
  building: 0x8a8a8a,
  marker: {
    residential: 0xe0a458,
    commercial: 0x4fa3d9,
    transit: 0xe0d04f,
    industrial: 0xc4553d,
    other: 0xb06fd0,
  },
} as const;

export type MarkerKind = keyof typeof PALETTE.marker;

/** Marker color for a landmark kind (unknown kinds fall back to `other`). */
export function markerColor(kind: string): number {
  return (PALETTE.marker as Record<string, number>)[kind] ?? PALETTE.marker.other;
}

export const MARKER_HEIGHT = 6;
const SEA_Y = -0.3;
const SEA_MARGIN = 2000;

const mat = (color: number): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, roughness: 1, metalness: 0 });

/**
 * Land polygon (spec coords) at y = 0, plus a large sea plane below it.
 * Shape is in the XY plane; rotateX(-PI/2) maps (x, y, z) -> (x, z, -y), so (x, y) -> (x, 0, -y),
 * identical to specToScene, and the +Z face normal becomes +Y (faces up).
 */
export function landMesh(land: Vec2[], bounds = { width: 0, height: 0 }): Object3D {
  const group = new Object3D();
  group.name = 'land';
  const shape = new Shape(land.map((p) => new Vector2(p.x, p.y)));
  const geo = new ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  group.add(new Mesh(geo, mat(PALETTE.land)));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of land) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  minX = Math.min(minX, 0);
  minY = Math.min(minY, 0);
  maxX = Math.max(maxX, bounds.width);
  maxY = Math.max(maxY, bounds.height);
  const w = maxX - minX + 2 * SEA_MARGIN;
  const d = maxY - minY + 2 * SEA_MARGIN;
  const sea = new Mesh(new PlaneGeometry(w, d), mat(PALETTE.sea));
  sea.rotateX(-Math.PI / 2);
  const c = specToScene({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, SEA_Y);
  sea.position.set(c.x, c.y, c.z);
  group.add(sea);
  return group;
}

export function ribbonMesh(positions: Vec2[], indices: number[], y: number, color: number): Mesh {
  const verts: number[] = [];
  for (const p of positions) {
    const s = specToScene(p, y);
    verts.push(s.x, s.y, s.z);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const m = mat(color);
  m.side = DoubleSide;
  return new Mesh(geo, m);
}

/** One InstancedMesh for every building. Unit box with its pivot at the bottom. */
export function buildingsMesh(buildings: Building[]): InstancedMesh {
  const geo = new BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mesh = new InstancedMesh(geo, mat(0xffffff), buildings.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scl = new Vector3();
  const color = new Color();
  const base = new Color(PALETTE.building);
  buildings.forEach((b, i) => {
    const c = specToScene(b.center);
    pos.set(c.x, 0, c.z);
    q.setFromAxisAngle(up, specAngleToSceneYaw(b.angle));
    scl.set(b.width, b.height, b.depth);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(i, m);
    const frac = (b.height * 3.7) % 1; // deterministic variation derived from height
    color.copy(base).multiplyScalar(0.75 + 0.5 * frac);
    mesh.setColorAt(i, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'buildings';
  return mesh;
}

/** Ground ring plus a thin pole (bottom at y = 0, top at MARKER_HEIGHT). Same color for both. */
export function landmarkMarker(kind: string): Group {
  const color = markerColor(kind);
  const group = new Group();

  const ringMat = mat(color);
  ringMat.side = DoubleSide;
  const ringGeo = new RingGeometry(2.2, 2.8, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new Mesh(ringGeo, ringMat);
  ring.position.y = 0.07;
  group.add(ring);

  const poleGeo = new CylinderGeometry(0.12, 0.12, MARKER_HEIGHT, 8);
  poleGeo.translate(0, MARKER_HEIGHT / 2, 0);
  group.add(new Mesh(poleGeo, mat(color)));

  return group;
}
