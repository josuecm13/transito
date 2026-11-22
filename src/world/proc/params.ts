/**
 * Default parameters of the procedural isthmus. Positions are map metres (6000 x 8000, origin SW).
 * These are coarse intent only (where rock rises, where towns are seeded); the geometry is derived.
 * Moves into specs/map/world.yaml once the director accepts the look (CLAUDE.md: specs first).
 */
import type { AirportParams } from './airport.ts';
import type { CoverParams } from './cover.ts';
import type { LakeParams } from './lake.ts';
import type { RoadParams } from './roads.ts';
import type { GrowthParams, SuitabilityParams } from './settlements.ts';
import type { TransitParams } from './transit.ts';
import type { CanalParams, RiverParams } from './water.ts';
import type { ReliefParams } from './relief.ts';

export const DEFAULT_CELL = 20;

export const RELIEF: ReliefParams = {
  seed: 7,
  background: 0.04,
  zones: [
    // La Cordillera: the main range across the north-east, highest along a SW-NE spine.
    { id: 'cordillera', kind: 'line', points: [{ x: 2900, y: 6000 }, { x: 4100, y: 5600 }, { x: 5200, y: 5200 }, { x: 6000, y: 4900 }], width: 1600, rate: 1.0 },
    // Its southern spurs, falling towards the corridor and the east edge.
    { id: 'cordillera-south', kind: 'line', points: [{ x: 4300, y: 5000 }, { x: 5200, y: 4000 }, { x: 5800, y: 2900 }], width: 1000, rate: 0.65 },
    // Hills between the lake and the city, joined to the range: the Transístmica crosses them.
    { id: 'central-hills', kind: 'line', points: [{ x: 2000, y: 3300 }, { x: 3200, y: 3700 }, { x: 4300, y: 4500 }], width: 1000, rate: 0.45 },
    // Highland link from the central hills to the range: closes the lake basin on the east, so the
    // eastern valleys drain south across the corridor and the Transístmica crosses hills east of the lake.
    { id: 'east-rim', kind: 'line', points: [{ x: 2700, y: 3600 }, { x: 3100, y: 4600 }, { x: 3100, y: 5700 }], width: 900, rate: 0.4 },
    // Continental divide west of the city: separates the lake basin from the Pacific (the canal cuts it).
    { id: 'divide-west', kind: 'line', points: [{ x: 0, y: 2800 }, { x: 1100, y: 3000 }, { x: 2100, y: 3250 }], width: 750, rate: 0.5 },
    // Low hills west of the canal.
    { id: 'west-hills', kind: 'line', points: [{ x: 200, y: 6000 }, { x: 250, y: 4500 }, { x: 350, y: 3300 }, { x: 600, y: 1900 }], width: 800, rate: 0.45 },
    // Dissected hills of the lake basin: flooding later turns their tops into islands.
    { id: 'lake-basin', kind: 'disc', at: { x: 1400, y: 5200 }, radius: 1800, rate: 0.14 },
  ],
  modulation: {
    lo: 0.45,
    hi: 1.45,
    octaves: { wavelength: 1400, octaves: 5, gain: 0.55 },
    warp: 450,
    grainDeg: 25,
    grainRatio: 1.8,
  },
  coastTaper: 900,
  coastWobble: { amplitude: 35, octaves: { wavelength: 260, octaves: 4, gain: 0.55 } },
  erosion: { iterations: 160, k: 0.05, m: 0.45, dt: 6, diffusion: 0.12 },
  peak: 420,
  peakQuantile: 0.995,
  seaFloor: { shore: 2, slope: 0.035 },
  hummocks: { amplitude: 120, octaves: { wavelength: 260, octaves: 3, gain: 0.5 }, inland: [700, 1800], maxSlope: 0.25 },
};

/** Gatún-style reservoir: dam on the main river near the Atlantic locks. */
export const LAKE: LakeParams = { damHint: { x: 650, y: 6250 }, snapRadius: 1000, minInland: 450, frameMargin: 0, targetKm2: 5 };

export const RIVERS: RiverParams = { minAreaKm2: 0.4, widthPerSqrtKm2: 5, maxWidth: 22 };

/** The canal: Caribbean entrance → dam (Atlantic locks) → lake → lowest pass → Pacific locks → Pacific. */
export const CANAL: CanalParams = {
  caribbean: { x: 700, y: 7500 },
  pacificLocks: { x: 1400, y: 1500 },
  pacific: { x: 1300, y: 200 },
  width: 110,
  depth: 12,
  digWeight: 0.08,
};

/** Tocumen-style airfield: searched near the east end of the corridor. */
export const AIRPORT: AirportParams = {
  hint: { x: 5250, y: 2000 },
  radius: 900,
  // Compressed like the city (~1:2.5 of Tocumen's 3,056 m): two close parallel runways, a slim field.
  runwayLength: 1200,
  runwaySpacing: 260,
  runwayWidth: 40,
  margin: 50,
  distanceWeight: 0.03,
  headingRange: [0, 50],
  apron: { length: 520, depth: 110, building: [300, 45] },
  edgeMargin: 200,
  towards: { x: 2900, y: 1300 },
  culvertPenalty: 400,
};

/** Main roads by stops; geometry comes from slope-cost routing. Airport stop is filled at run time. */
export const ROAD_STOPS = {
  colon: { x: 1900, y: 6950 },
  city: { x: 2900, y: 1300 },
  cityNorth: { x: 3100, y: 2000 },
  oldQuarter: { x: 2420, y: 420 },
  pacifica: { x: 3850, y: 800 },
  balboa: { x: 900, y: 1250 },
  gamboa: { x: 1450, y: 3600 },
};

export const ROADS: Omit<RoadParams, 'routes'> = {
  grade: {
    highway: { g0: 0.06, k: 3, maxGrade: 0.3 },
    road: { g0: 0.08, k: 2, maxGrade: 0.35 },
    rail: { g0: 0.03, k: 6, maxGrade: 0.2 },
  },
  bridge: 25,
  seaBridge: 250,
  canalBridge: 120,
  reuse: 0.35,
};

export const SUITABILITY: SuitabilityParams = { maxSlope: 0.22, heightBand: [60, 160], coastFade: 0.55, coastRange: 2500, crossing: 0.15 };

export const GROWTH: Omit<GrowthParams, 'towns'> = { roadDiscount: 0.3, jitter: 2.2, jitterWavelength: 220, minSuitability: 0.12, seedSnap: 450, seed: 13 };

export const TOWNS: GrowthParams['towns'] = [
  { id: 'la-ciudad', seeds: [{ x: 2450, y: 450 }, { x: 2950, y: 1250 }], targetKm2: 3.3 },
  { id: 'colon', seeds: [{ x: 1900, y: 7250 }], targetKm2: 1.1 },
  { id: 'balboa', seeds: [{ x: 850, y: 1150 }], targetKm2: 0.7 },
  // Seeds are replaced at run time by points along the Interamericana between the city and the airport.
  { id: 'el-corredor', seeds: [], targetKm2: 1.3, roadAffinity: 3 },
  { id: 'gamboa', seeds: [{ x: 1420, y: 3050 }], targetKm2: 0.1 },
];

export const COVER: CoverParams = {
  seed: 19,
  beachWidth: 25,
  mangrove: { maxHeight: 4, riverAreaKm2: 3, reach: 140 },
  clearing: { wavelength: 300, threshold: 0.5, lowlandBonus: 0.3, fringeBonus: 0.7 },
  highForest: { height: 230, slope: 0.4 },
};

/**
 * Metro de la Ciudad and the interoceanic railway (director's sketch, 2026-11-22). Stops are
 * terminals, interchanges and via points; track geometry and the stations between stops are derived.
 * `AIRPORT_TERMINAL` is replaced at run time by the airport's terminal position.
 */
export const AIRPORT_TERMINAL = { x: -1, y: -1 };
export const TRANSIT_STOPS = {
  oldQuarterTip: { x: 2380, y: 320 },
  casco: { x: 2560, y: 760 },
  north: { x: 3050, y: 2050 },
  westJunction: { x: 2150, y: 1450 },
  westNorth: { x: 2050, y: 1950 },
  balboa: { x: 850, y: 1150 },
  bayEast: { x: 3800, y: 950 },
  colon: { x: 1900, y: 7100 },
};
const T = TRANSIT_STOPS;
export const TRANSIT: TransitParams = {
  lines: [
    { id: 'linea-1', name: 'Línea 1', mode: 'metro', color: [214, 40, 40], branches: [[T.oldQuarterTip, T.casco, T.north]], stationSpacing: 500 },
    {
      id: 'linea-2',
      name: 'Línea 2',
      mode: 'metro',
      color: [52, 178, 74],
      branches: [
        [T.balboa, T.casco, T.bayEast],
        [T.north, AIRPORT_TERMINAL],
      ],
      stationSpacing: 650,
    },
    { id: 'linea-3', name: 'Línea 3', mode: 'metro', color: [236, 196, 40], branches: [[T.casco, T.westJunction, T.north], [T.westJunction, T.westNorth]], stationSpacing: 500 },
    { id: 'ferrocarril', name: 'Ferrocarril Interoceánico', mode: 'rail', color: [150, 96, 196], branches: [[T.north, T.colon]], stationSpacing: 1000 },
  ],
  offUrban: 2.5,
  offRoad: 1.8,
  grade: { metro: 0.06, rail: 0.04 },
  bridge: 6,
  interchangeRadius: 90,
};
