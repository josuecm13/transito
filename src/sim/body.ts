/** Capsule body for a standing human, meters. Total height = 2*(halfHeight + radius). */
export type HumanBody = { readonly radius: number; readonly halfHeight: number };

export const TITO_BODY: HumanBody = { radius: 0.35, halfHeight: 0.55 }; // 1.80 m
export const PEDESTRIAN_BODY: HumanBody = { radius: 0.3, halfHeight: 0.55 }; // 1.70 m

/** Full standing height, meters. */
export function bodyHeight(b: HumanBody): number {
  return 2 * (b.halfHeight + b.radius);
}

/** Distance from the feet to the capsule center, meters (feet sit at the bottom of the lower cap). */
export function centerY(b: HumanBody): number {
  return b.halfHeight + b.radius;
}
