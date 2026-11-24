import type { Vec2 } from './vec.ts';

/** Water the game draws: river courses, flat water surfaces (lake, canal, lock chambers) and locks. */
export interface RiverCourse {
  readonly id: string;
  readonly inspiredBy?: string;
  /** 'coast' or the id of the water body the river feeds. */
  readonly outlet: string;
  readonly mouth: Vec2;
  /** Vertices, source -> mouth, about one far-grid cell apart. */
  readonly points: readonly Vec2[];
  /** Water surface height (m) per vertex: non-increasing from source to mouth, the sea / lake level at the mouth. */
  readonly surface: readonly number[];
  /** Channel width (m) per vertex (Leopold-Maddock: w = a sqrt(A), capped by rivers.max_width). */
  readonly width: readonly number[];
  /** Channel depth (m) per vertex: the bed lies `depth` below the surface. */
  readonly depth: readonly number[];
  /** Drainage area (km2) per vertex, non-decreasing downstream. */
  readonly drainageKm2: readonly number[];
  readonly length: number;
  /** Source-to-mouth straight distance (m). */
  readonly chord: number;
  readonly tortuosity: number;
  /** Largest amount (m) the water surface stands above the uncarved ground along the course (pits that were filled). */
  readonly maxFill: number;
}

export interface WaterPolygon {
  readonly id: string;
  readonly kind: 'lake' | 'canal' | 'chamber';
  readonly level: number;
  readonly ring: readonly Vec2[];
  readonly holes: readonly (readonly Vec2[])[];
}

export interface LockChamber {
  /** 1 = the chamber nearest the sea. */
  readonly index: number;
  /** Water level (m) of the chamber. */
  readonly level: number;
  /** Chamber floor height (m). */
  readonly floor: number;
  readonly center: Vec2;
  /** Direction of the chamber's long axis (rad, spec plane). */
  readonly angle: number;
  readonly length: number;
  readonly width: number;
  /** The water rectangle, 4 corners CCW. */
  readonly ring: readonly Vec2[];
  /** The concrete apron around the chamber, 4 corners CCW. */
  readonly apron: readonly Vec2[];
}

export interface LockOut {
  readonly id: string;
  readonly landmark: string;
  readonly position: Vec2;
  readonly steps: number;
  readonly chamber: readonly [number, number];
  /** Height (m) of the lock walls / apron top. */
  readonly apronTop: number;
  /** -1: the sea lies toward the start of the centreline; +1 toward its end. */
  readonly seaSide: -1 | 1;
  readonly chambers: readonly LockChamber[];
}
