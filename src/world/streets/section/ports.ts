/**
 * Ports: the open ends of a section (position, heading, class, width). A port sits at the TIP of the
 * opening road, a little outside the boundary road, and its heading points away from the section.
 * Two sections meet when a port of one and a port of the other coincide with opposite headings and a
 * compatible class and width: the two tips then merge into one node of one continuous road.
 */
import type { Vec2 } from '../../vec.ts';

export interface SectionPort {
  /** Tip of the opening road (outside the boundary road). */
  at: Vec2;
  /** Where the road crosses the boundary road. */
  crossing: Vec2;
  /** Direction pointing out of the section, radians. */
  heading: number;
  cls: string;
  /** Carriageway width (m). */
  width: number;
  /** A fixed through route (an avenue) rather than an opening the generator chose. */
  through: boolean;
}

export interface PortTolerance {
  /** Max distance between the two tips (m). */
  position: number;
  /** Max deviation of the headings from exactly opposite (radians). */
  heading: number;
  /** Max difference of carriageway width (m). */
  width: number;
}

/** Why two ports do not join (empty = they do). */
export function portMismatch(a: SectionPort, b: SectionPort, tol: PortTolerance): string[] {
  const out: string[] = [];
  const d = Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y);
  if (d > tol.position) out.push(`positions ${d.toFixed(2)} m apart (> ${tol.position})`);
  let dh = Math.abs(a.heading - b.heading - Math.PI) % (2 * Math.PI);
  if (dh > Math.PI) dh = 2 * Math.PI - dh;
  if (dh > tol.heading) out.push(`headings are ${((dh * 180) / Math.PI).toFixed(1)} deg off opposite (> ${((tol.heading * 180) / Math.PI).toFixed(1)})`);
  if (a.cls !== b.cls) out.push(`classes differ: ${a.cls} vs ${b.cls}`);
  if (Math.abs(a.width - b.width) > tol.width) out.push(`widths differ: ${a.width} vs ${b.width}`);
  return out;
}
