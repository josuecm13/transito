import type { Object3D } from 'three/webgpu';

/** Scene space: Three.js, Y-up, north = -Z. Every component is optional and data-only. */
export interface Entity {
  /** World position in scene space. */
  position: { x: number; y: number; z: number };
  /** Heading around the Y axis, radians. */
  yaw?: number;
  /** Linear velocity, m/s. */
  velocity?: { x: number; y: number; z: number };
  /** The controlled character. */
  player?: true;
  /** Ambient population spawns around this entity. */
  populationFocus?: true;
  /** The camera follows this entity. */
  cameraTarget?: true;
  /** Other agents treat it as blocking. */
  obstacle?: { radius: number };
  /** Rapier rigid-body handle owned by physics. */
  body?: { handle: number };
  /** Three.js object that renders this entity. */
  view?: { object: Object3D };
  /** Ambient pedestrian (pedestrians plugin). */
  pedestrian?: { speed: number };
  /** Walks along a path-graph edge (pedestrians plugin). */
  follower?: { edge: number; t: number; forward: boolean; blocked: boolean };
  /** Proximity area, e.g. the shop prompt. */
  trigger?: { radius: number; label: string; inside: boolean };
}
