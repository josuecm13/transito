# 03.02 — Layer 2: relief

## Inputs
Layer 1 not needed numerically; spec `relief:`, `geometry.land`, authored `ridges`, `hills`, `flatten`; reference slope
distributions (frozen).

## Algorithm
Keep `terrain.ts`: `base = coastal ramp (or sea floor) + (1 - hill mask) * rolling + sum(hill masks * (uplift + noise))`,
flatten zones, landmark pads, street grading, baked grid, bilinear query. Add:
1. **Ridges** (linear features): signed distance `s` to an authored polyline; profile `h = A * exp(-(s/w)^2)` plus along-ridge
   noise; combined with hills by smooth-max `smax(a,b,k) = ((a^p + b^p)^(1/p))`, p = 4. Generalises radial hills to the hill wall north
   of the corridor and the continental divide.
2. **Multi-resolution domain**: whole isthmus at 16 m (heights need not be 4 m outside the active rect), active rect keeps 4 m.
3. **Heights are scaled, slopes are real** (skill rule 3): `h_map = h_real * k_h` with `k_h` chosen so slope p50/p90 match
   the real bands; the map compresses horizontally 1:3 to 1:10.
4. Output `H0` (base) only; carving by rivers/canal/airports is added by layers 3-4 (`../02-alternatives/approaches.md`).

## Parameters (defaults)
Existing (`world.yaml: relief`): sea floor slope 0.08, coastal ramp 0.004 to 14 m, rolling amplitude 19 m / 380 m,
`san-miguelito` uplift 38 m radius 1000 m, `max_grade` 0.22, grid cell 4 m. New:
| Name | Default | Unit |
|---|---|---|
| ridge `width` | 350 | m (half-width at 1/e) |
| ridge `amplitude` | 90-160 | m |
| `smax.p` | 4 | - |
| `cell_far` | 16 | m |

## Proposed spec
```yaml
relief:
  ridges:
    - { id: north-wall, inspired_by: "hill wall 150-450 m north of the corridor", points: [[4300, 4300], [5000, 4600], [5800, 4400]], width: 350, amplitude: 120 }
    - { id: continental-divide, inspired_by: "Continental Divide", points: [[3000, 5600], [4300, 5000], [5500, 5500]], width: 450, amplitude: 160 }
  hills:
    - { id: ancon, inspired_by: "Ancón Hill", at: [1900, 950], core_radius: 120, radius: 350, uplift: 40, noise: { amplitude: 6, wavelength: 120, octaves: 3, persistence: 0.5 } }
  grid: { cell: 4, margin: 120, far: { cell: 16 } }
```

## Pure test
Existing `tests/terrain.test.ts` bands stay. Add: ridge crest is the local max across the ridge (sample perpendicular profile);
whole-isthmus land slope percentiles in band; runway flatness 0.05 m; coast |h| <= 0.5 m; determinism. Mutation: set a ridge
amplitude to 0, expect the crest test red.

## Metric band (real reference: `real-geography.md`, AWS terrain tiles z10 / z13)
| Metric | Real | Band proposed |
|---|---|---|
| Land slope p50 / p90 (isthmus) | 6.4 % / 22.8 % | +-25 % |
| Corridor land slope p50 / p90 (z13) | 8.4 % / 26.5 % | +-25 % |
| Hill bands (existing) | Samaria 16.0 / 30.1 / 42.1 % | existing `targets.hills` |
| Share of land < 30 m (isthmus) | 17.7 % | +-8 points |
| Share of land < 10 m (corridor) | 16.8 % (13 km2 with slope < 2 %) | upper bound (SRTM reads mangrove as 0) |

## Kept / replaced
Kept: all of `terrain.ts`. Added: ridges, far grid, whole-isthmus extent (today the grid is rect + 120 m margin).
Replaced: none.
