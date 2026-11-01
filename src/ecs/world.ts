import { World } from 'miniplex';
import type { Entity } from './entity.ts';

export type Ecs = World<Entity>;

export function createEcs(): Ecs {
  return new World<Entity>();
}
