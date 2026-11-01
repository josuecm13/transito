export interface TriggerState {
  inside: boolean;
  event: 'enter' | 'exit' | null;
}

/** Enter at distance <= radius; exit only beyond radius + hysteresis (no flicker at the edge). */
export function updateTrigger(
  inside: boolean,
  distance: number,
  radius: number,
  hysteresis: number,
): TriggerState {
  if (!inside) {
    return distance <= radius ? { inside: true, event: 'enter' } : { inside: false, event: null };
  }
  return distance > radius + hysteresis ? { inside: false, event: 'exit' } : { inside: true, event: null };
}
