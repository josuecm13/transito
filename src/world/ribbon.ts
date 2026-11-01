import type { Vec2 } from './vec.ts';
import { offsetPolyline } from './geometry.ts';

/**
 * Triangle strip along a centerline. Left/right are relative to the travel direction.
 * Points are interleaved (left_i, right_i); triangles are counter-clockwise in the spec plane.
 */
export function ribbon(
  centerline: Vec2[],
  halfWidthLeft: number,
  halfWidthRight: number,
): { positions: Vec2[]; indices: number[] } {
  const left = offsetPolyline(centerline, halfWidthLeft);
  const right = offsetPolyline(centerline, -halfWidthRight);
  const positions: Vec2[] = [];
  const indices: number[] = [];
  for (let i = 0; i < centerline.length; i++) {
    positions.push(left[i] as Vec2, right[i] as Vec2);
  }
  for (let i = 0; i < centerline.length - 1; i++) {
    const l0 = 2 * i;
    const r0 = l0 + 1;
    const l1 = l0 + 2;
    const r1 = l0 + 3;
    indices.push(l0, r0, l1, r0, r1, l1);
  }
  return { positions, indices };
}
