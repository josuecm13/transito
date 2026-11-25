/**
 * District presets (#13): compact starting points for the Places group, drawn from
 * docs/map-reshape/01-investigation/panama-city-signature-places.md. A preset fixes style, reach and strength;
 * the director (or an agent) chooses where. Macro intent only: street style belongs to #7.
 */
import type { DistrictStyle } from '../world/proc/districts.ts';

export interface DistrictPreset {
  readonly id: string;
  readonly style: DistrictStyle;
  readonly sigma: number;
  readonly weight: number;
  /** Where it attaches: a point (`at`), a road route (`along`) or the airfield (`around`). */
  readonly anchor: 'at' | 'along' | 'around';
  readonly describe: string;
}

export const DISTRICT_PRESETS: readonly DistrictPreset[] = [
  { id: 'casco-historic-grid', style: 'historic-core', sigma: 260, weight: 0.9, anchor: 'at', describe: 'Casco Viejo-inspired compact old quarter on a peninsula: small tight core.' },
  { id: 'cinta-costera', style: 'bayfront-linear', sigma: 180, weight: 0.55, anchor: 'along', describe: 'Linear green park and coastal avenue: a thin ribbon along a road route; keeps density low and open.' },
  { id: 'paitilla-pacifica-towers', style: 'tower-cluster', sigma: 320, weight: 1, anchor: 'at', describe: 'Punta Paitilla / Pacífica-inspired tower point on the bay: tallest, densest cluster.' },
  { id: 'san-miguelito-hillside', style: 'hillside-lowrise', sigma: 700, weight: 0.6, anchor: 'at', describe: 'San Miguelito-inspired hillside low-rise: wide, medium density that follows slopes (formal or incremental, not a quality judgement).' },
  { id: 'el-corredor-ribbon', style: 'ribbon', sigma: 260, weight: 0.45, anchor: 'along', describe: 'El Corredor low-rise ribbon along a highway: long and thin, never a second skyscraper cluster.' },
  { id: 'tocumen-buffer', style: 'buffer', sigma: 900, weight: -0.8, anchor: 'around', describe: 'Airport buffer: pushes density away from the airfield.' },
  { id: 'balboa-port', style: 'port', sigma: 380, weight: 0.5, anchor: 'at', describe: 'Balboa-style port district: low, broad, industrial.' },
  { id: 'colon-port', style: 'port', sigma: 380, weight: 0.5, anchor: 'at', describe: 'Colón-style port district on the Caribbean side.' },
];

export const presetById = (id: string): DistrictPreset | undefined => DISTRICT_PRESETS.find((p) => p.id === id);
