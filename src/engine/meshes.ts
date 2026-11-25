import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three/webgpu';
import type { Vec2 } from '../world/vec.ts';
import type { Building } from '../world/blockout.ts';
import type { TriSoup } from '../world/street-surface.ts';
import { specAngleToSceneYaw, specToScene } from '../world/coords.ts';

export const PALETTE = {
  land: 0x6b7a66,
  sea: 0x1d4e7a,
  asphalt: 0x2f3236,
  sidewalk: 0xb9b9b2,
  runway: 0x7d8086,
  rail: 0x4a4038,
  waterway: 0x2a6a9a,
  /** Rivers, Gatún Lake, the canal channel and lock chambers (same blue as the canal waterway). */
  water: 0x2a6a9a,
  lockWall: 0x9b9a96,
  lockApron: 0xb3b0a7,
  building: 0x8a8a8a,
  street: {
    avenue: 0x2a2d31,
    collector: 0x33363b,
    local: 0x3c3f44,
    alley: 0x5a564f,
  },
  centerSolid: 0xe2bf45,
  centerDashed: 0xeeeee6,
  blockGround: 0x9d978a,
  /** Ground colour by land-cover class (layer 1) on the far ground outside the active area. */
  cover: {
    water: 0x1d4e7a,
    mangrove: 0x5d6b3c,
    forest: 0x2c5632,
    clearing: 0x86974f,
    grass: 0x78a05a,
    urban_prior: 0xa59d8d,
    park_reclaimed: 0x8dbb6a,
  } as Record<string, number>,
  park: 0x679a4a,
  median: 0x6f9452,
  court: 0xb4573c,
  courtLine: 0xf0efe6,
  buildingResidential: 0x9c9183,
  buildingCommercial: 0x808b97,
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
 * Flat ground (sea, land, city ground) is drawn first, in this order, without writing depth: each
 * layer simply paints over the previous one, so coplanar or nearly coplanar layers never z-fight,
 * whatever the depth-buffer precision. Everything standing on the ground (buildings, characters,
 * markers) writes depth as usual and is drawn afterwards.
 */
export const DEPTH_PREPASS_ORDER = -10;
export const GROUND_ORDER = { sea: -3, land: -2, far: -1.5, apron: -1.45, water: -1.4, city: -1 } as const;

/**
 * Ground layers are painted in order and write no depth (see GROUND_ORDER), so by themselves a hill hides nothing behind it:
 * the 70 m lake and the far water showed through the mountains. This is the same geometry drawn first, depth only and
 * pushed back a little, so terrain occludes what lies behind it while the flat layers on top of it still win.
 */
export function depthPrepass(ground: Mesh, name = `${ground.name}:depth`): Mesh {
  const material = new MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  material.polygonOffset = true;
  material.polygonOffsetFactor = 2;
  material.polygonOffsetUnits = 2;
  const mesh = new Mesh(ground.geometry, material);
  mesh.renderOrder = DEPTH_PREPASS_ORDER;
  mesh.name = name;
  return mesh;
}

/** Adds a terrain ground mesh to the scene together with its depth prepass; every terrain ground must go through here. */
export function addGround(scene: Object3D, ground: Mesh): Mesh {
  scene.add(ground, depthPrepass(ground));
  return ground;
}

function asGround<T extends Mesh>(mesh: T, order: number): T {
  mesh.renderOrder = order;
  (mesh.material as MeshStandardMaterial).depthWrite = false;
  return mesh;
}

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
  group.add(asGround(new Mesh(geo, mat(PALETTE.land)), GROUND_ORDER.land));

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
  group.add(asGround(sea, GROUND_ORDER.sea));
  return group;
}

/** One flat layer of a merged ground mesh: triangles (spec plane) at height y with one colour (or one per vertex). */
export interface GroundLayer {
  soup: TriSoup;
  y: number;
  color: number;
  /** Per-vertex colour (spec plane); overrides `color`. */
  colorAt?: (x: number, y: number) => number;
}

/** Terrain the ground is draped over: height (m) and unit normal (spec axes: x east, y north, z up). */
export interface GroundSurface {
  heightAt(x: number, y: number): number;
  normalAt(x: number, y: number): { x: number; y: number; z: number };
}

/**
 * Every layer merged into one BufferGeometry with vertex colours: a single draw call for the whole
 * ground (blocks, parks, sidewalks, carriageways, markings). Triangles are emitted in layer order and
 * the mesh does not write depth (see GROUND_ORDER), so later layers paint over earlier ones; `y`
 * only lifts them visually. Without a `surface` the ground is flat at y (normals straight up); with
 * one every vertex takes `surface.heightAt + y` and the terrain normal, so the soups must already be
 * subdivided (world/drape.ts). Triangles must be CCW in the spec plane (they then face +Y).
 */
export function groundMesh(layers: readonly GroundLayer[], name = 'ground', surface?: GroundSurface): Mesh {
  let n = 0;
  let m = 0;
  for (const l of layers) {
    n += l.soup.positions.length / 2;
    m += l.soup.indices.length;
  }
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const idx = n > 65535 ? new Uint32Array(m) : new Uint16Array(m);
  const c = new Color();
  let v = 0;
  let k = 0;
  for (const l of layers) {
    c.setHex(l.color);
    const base = v;
    const p = l.soup.positions;
    for (let i = 0; i < p.length; i += 2) {
      const px = p[i] as number;
      const py = p[i + 1] as number;
      const s = specToScene({ x: px, y: py }, l.y + (surface ? surface.heightAt(px, py) : 0));
      pos[v * 3] = s.x;
      pos[v * 3 + 1] = s.y;
      pos[v * 3 + 2] = s.z;
      if (surface) {
        const n = surface.normalAt(px, py);
        nor[v * 3] = n.x;
        nor[v * 3 + 1] = n.z;
        nor[v * 3 + 2] = -n.y;
      } else {
        nor[v * 3 + 1] = 1;
      }
      if (l.colorAt) c.setHex(l.colorAt(px, py));
      col[v * 3] = c.r;
      col[v * 3 + 1] = c.g;
      col[v * 3 + 2] = c.b;
      v++;
    }
    for (const i of l.soup.indices) idx[k++] = base + i;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setIndex(new (idx instanceof Uint32Array ? Uint32BufferAttribute : Uint16BufferAttribute)(idx, 1));
  geo.computeBoundingSphere();
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = asGround(new Mesh(geo, material), GROUND_ORDER.city);
  mesh.name = name;
  return mesh;
}

/**
 * The far ground (whole isthmus outside the detailed active area): a draped triangle soup (world/drape.ts)
 * with one colour per vertex from `colorAt`, as a single draw call. Drawn over the flat land and under
 * the city ground; it does not write depth (see GROUND_ORDER). Triangles must be CCW in the spec plane.
 */
export function farGroundMesh(soup: TriSoup, surface: GroundSurface, colorAt: (x: number, y: number) => number, name = 'far-ground'): Mesh {
  const n = soup.positions.length / 2;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new Color();
  for (let v = 0; v < n; v++) {
    const px = soup.positions[v * 2] as number;
    const py = soup.positions[v * 2 + 1] as number;
    const s = specToScene({ x: px, y: py }, surface.heightAt(px, py));
    pos[v * 3] = s.x;
    pos[v * 3 + 1] = s.y;
    pos[v * 3 + 2] = s.z;
    const nm = surface.normalAt(px, py);
    nor[v * 3] = nm.x;
    nor[v * 3 + 1] = nm.z;
    nor[v * 3 + 2] = -nm.y;
    c.setHex(colorAt(px, py));
    col[v * 3] = c.r;
    col[v * 3 + 1] = c.g;
    col[v * 3 + 2] = c.b;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setIndex(new Uint32BufferAttribute(Uint32Array.from(soup.indices), 1));
  geo.computeBoundingSphere();
  const mesh = asGround(new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })), GROUND_ORDER.far);
  mesh.name = name;
  return mesh;
}

/** A flat or sloped surface: x, y (spec plane), h (height) per vertex, CCW triangles in the spec plane. */
export interface HeightSoup {
  positions: number[];
  indices: number[];
}

/** Lifts a flat TriSoup to a constant height. */
export function liftSoup(soup: TriSoup, h: number): HeightSoup {
  const positions: number[] = [];
  for (let i = 0; i < soup.positions.length; i += 2) positions.push(soup.positions[i] as number, soup.positions[i + 1] as number, h);
  return { positions, indices: [...soup.indices] };
}

/**
 * Water or concrete surface at explicit heights (rivers follow their bed, the lake and chambers are flat). Drawn over the
 * far ground and under the city ground (GROUND_ORDER), without writing depth, like every other ground layer.
 */
export function surfaceMesh(soup: HeightSoup, color: number, kind: 'water' | 'apron', name: string): Mesh {
  const n = soup.positions.length / 3;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const s = specToScene({ x: soup.positions[v * 3] as number, y: soup.positions[v * 3 + 1] as number }, soup.positions[v * 3 + 2] as number);
    pos[v * 3] = s.x;
    pos[v * 3 + 1] = s.y;
    pos[v * 3 + 2] = s.z;
    nor[v * 3 + 1] = 1;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setIndex(new Uint32BufferAttribute(Uint32Array.from(soup.indices), 1));
  geo.computeBoundingSphere();
  const mesh = asGround(new Mesh(geo, new MeshStandardMaterial({ color, roughness: kind === 'water' ? 0.35 : 1, metalness: 0 })), GROUND_ORDER[kind]);
  mesh.name = name;
  return mesh;
}

/** Concrete lock walls (grey blockout boxes) along both sides of a chamber; they stand on the ground and write depth. */
export function lockWallsMesh(chambers: readonly { center: Vec2; angle: number; length: number; width: number; floor: number }[], top: number, name = 'lock-walls'): Group {
  const group = new Group();
  group.name = name;
  const wall = 5;
  for (const c of chambers) {
    const h = top + 0.3 - c.floor;
    const holder = new Object3D();
    const p = specToScene(c.center, c.floor + h / 2);
    holder.position.set(p.x, p.y, p.z);
    holder.rotation.y = specAngleToSceneYaw(c.angle);
    for (const side of [-1, 1]) {
      const box = new Mesh(new BoxGeometry(c.length, h, wall), mat(PALETTE.lockWall));
      box.position.z = side * (c.width / 2 + wall / 2);
      holder.add(box);
    }
    group.add(holder);
  }
  return group;
}

/** Earcut triangulation (three's ShapeUtils) of polygons with holes, as one CCW triangle soup. */
export function triangulatePolygons(polys: Iterable<{ outer: readonly Vec2[]; holes: readonly (readonly Vec2[])[] }>): TriSoup {
  const out: TriSoup = { positions: [], indices: [] };
  for (const poly of polys) {
    if (poly.outer.length < 3) continue;
    const contour = poly.outer.map((p) => new Vector2(p.x, p.y));
    const holes = poly.holes.filter((h) => h.length >= 3).map((h) => h.map((p) => new Vector2(p.x, p.y)));
    const base = out.positions.length / 2;
    const all = [...contour, ...holes.flat()];
    for (const p of all) out.positions.push(p.x, p.y);
    for (const tri of ShapeUtils.triangulateShape(contour, holes)) {
      const [a, b, c] = tri as [number, number, number];
      const pa = all[a] as Vector2;
      const pb = all[b] as Vector2;
      const pc = all[c] as Vector2;
      const ccw = (pb.x - pa.x) * (pc.y - pa.y) - (pc.x - pa.x) * (pb.y - pa.y) >= 0;
      out.indices.push(base + a, base + (ccw ? b : c), base + (ccw ? c : b));
    }
  }
  return out;
}

/** Ribbon triangles (`world/ribbon.ts`, Vec2 positions) as a TriSoup. */
export function ribbonSoup(positions: readonly Vec2[], indices: readonly number[]): TriSoup {
  return { positions: positions.flatMap((p) => [p.x, p.y]), indices: [...indices] };
}

/**
 * One InstancedMesh for every building. Unit box with its pivot at the bottom.
 * `baseColor` picks each building's tone (default PALETTE.building); a deterministic ±25% shade
 * derived from its height is applied on top. `baseY` gives each building's base height (default 0).
 */
export function buildingsMesh<B extends Building>(buildings: B[], baseColor?: (b: B) => number, baseY?: (b: B) => number): InstancedMesh {
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
    if (baseColor) base.setHex(baseColor(b));
    const c = specToScene(b.center);
    pos.set(c.x, baseY ? baseY(b) : 0, c.z);
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

/**
 * Ground ring plus a thin pole (bottom at y = 0, top at MARKER_HEIGHT). Same color for both.
 * `normal` (scene axes) tilts the ring to lie on sloped ground; the pole stays vertical.
 */
export function landmarkMarker(kind: string, normal?: { x: number; y: number; z: number }): Group {
  const color = markerColor(kind);
  const group = new Group();

  const ringMat = mat(color);
  ringMat.side = DoubleSide;
  const ringGeo = new RingGeometry(2.2, 2.8, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new Mesh(ringGeo, ringMat);
  ring.position.y = 0.12; // above the ground layers (world-view LAYER_Y)
  if (normal) ring.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(normal.x, normal.y, normal.z));
  group.add(ring);

  const poleGeo = new CylinderGeometry(0.12, 0.12, MARKER_HEIGHT, 8);
  poleGeo.translate(0, MARKER_HEIGHT / 2, 0);
  group.add(new Mesh(poleGeo, mat(color)));

  return group;
}
