# 03.03 — Layer 3a: rivers

## Inputs
Layer 2 `H0`; layer 1 (cover re-mask, mangrove mouth); spec `rivers:` (authored outlets and optional guide points).

## Algorithm
1. Scratch copy of `H0`; priority-flood fill (Barnes 2014) from sea + frame, heap ties broken by cell index.
2. D8 flow direction and accumulation `A` (cells), fixed neighbour order.
3. Streams = cells with `A >= A_min`; **authored outlets**: each river entry names a mouth point and optional guide points;
   a guide adds a low-cost corridor (cost reduction) so D8 follows it, not a forced polyline.
4. Width by hydraulic geometry `w = a * Q^0.5` (Leopold & Maddock 1953), `Q ~ A`; calibrate `a` so the largest river hits `w_max`.
5. Carve: trapezoid channel depth `d = c * w^0.8`, bank slope 1:2, floodplain band `5 w` blended by smoothstep. Outputs
   `carve_rivers` delta and a water mask. Mouths in tidal band widen (estuary); mangrove from layer 1.
6. Bridges are **not** chosen here; layer 5 chooses crossings (min width) and reads the river polygons.
7. Rivers are `waterway` barriers for streets (`BARRIER_KINDS` already contains `waterway`).

## Parameters (defaults)
| Name | Default | Unit |
|---|---|---|
| `A_min` | 0.04 | km2 (about 156 cells of 16 m); real threshold 1.5 km2 divided by about 36 (1:6 horizontal) as a start, tuned to the band |
| `w_max` | 40 | m (Río Juan Díaz scale in map; canal is separate) |
| `a` | calibrated | m / (cell^0.5) |
| `depth_c` | 0.35 | m^0.2 |
| `floodplain` | 5 | x width |

## Proposed spec
```yaml
rivers:
  seed: 31
  accumulation_min_km2: 0.04
  max_width: 40
  items:
    - { id: rio-juan-diaz, inspired_by: "Río Juan Díaz", mouth: [4200, 640], guide: [[4300, 2400], [4400, 3400]] }
    - { id: rio-tocumen,   inspired_by: "Río Tocumen",   mouth: [5240, 300], guide: [[5300, 1500]] }
    - { id: rio-abajo,     inspired_by: "Río Abajo",     mouth: [3300, 930], guide: [[3400, 2500]] }
```
(mouth coordinates are proposals; each must be a shoreline point of `geometry.land`, a test checks it.)

## Pure test
Every river: monotone non-increasing height along its path (after carve); ends in sea or lake; no loops; D8 reproduction check
on **real** terrain tiles (>= 80 % of real centreline within 300 m, the investigation's own figure); mouth on the coast;
spacing and basin bands. Mutation: raise a pit on a river course; monotone test must fail.

## Metric band (real: `real-geography.md`)
| Metric | Real | Map band |
|---|---|---|
| Rivers crossing the corridor | 7, spacing 2-5 km, basin 10-25 km2 | spacing 300-800 m at 1:6.3 (investigation figure) |
| Drainage density (z13) | 210 km stream in 412 km2 = 0.5 km/km2 | x compression factor, TBM after the first generation |
| D8 vs OSM on real terrain | 84-97 % (Cabra 55 %) | >= 80 % |
| Width exponent | 0.5 | exact (formula) |

## Kept / replaced
Kept: `waterway` kind, barrier logic, renderer colour. New: everything else (no rivers exist today).
