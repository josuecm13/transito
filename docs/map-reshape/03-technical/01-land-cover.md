# 03.01 — Layer 1: land cover (jungle)

## Inputs
Spec only (+ `geometry.land` coast distance field, authored zones, seed). No relief, no rivers (layer order).
Optional refs: class shares from WorldCover/OSM landuse (needs approval, see `01-investigation/open-data-sources.md`).

## Algorithm
1. Coast distance `d(p)` by a 2-pass distance transform on the 16 m grid (existing relief already computes shore distance,
   `terrain.ts`).
2. Class field by priority: `water` (outside land) > `mangrove` if `d < mangrove_band` on the **Pacific/Caribbean shore flagged
   tidal** > `urban_prior` inside authored `settlement` discs > `forest` (jungle) default > `clearing` (noise threshold) >
   `grass`.
3. Forest density `f = clamp(f0 + a*noise(p, wavelength w) + b*smoothstep(d0, d1, d), 0, 1)`; classes by thresholds on `f`.
4. Consumer-side re-mask (no new layer): water bodies and rivers (layer 3) override cover; slope > `bare_slope` -> `bare`
   (relief); both applied at read time.
5. Output: class grid (u8) + forest density (u8). Used by ground colour, vegetation instancing, fog tint, minimap.

## Parameters (defaults)
| Name | Default | Unit | Note |
|---|---|---|---|
| `mangrove_band` | 250 | m | along tidal shores only (south-east estuary, Limón Bay inner shore) |
| `f0` | 0.75 | 0-1 | inland jungle density |
| `noise.wavelength` | 400 | m | patchiness; `octaves` 3, `persistence` 0.5 |
| `clearing_threshold` | 0.25 | 0-1 | below this `f` -> clearing |
| `bare_slope` | 0.60 | rise/run | read-time re-mask |
| `cell_far` | 16 | m | whole-isthmus grid |

## Proposed spec
```yaml
land_cover:
  seed: 21
  classes: [water, mangrove, forest, clearing, grass, urban_prior]
  mangrove: { band: 250, shores: [tocumen-estuary, limon-bay-inner] }
  forest: { density: 0.75, noise: { wavelength: 400, octaves: 3, persistence: 0.5 }, clearing_below: 0.25 }
  settlements:            # authored discs/polygons; real towns inspire placement (inspired_by)
    - { id: colon-urban, at: [1750, 7050], radius: 700, inspired_by: "Colón" }
```

## Pure test
`tests/layers-land-cover.test.ts`: (a) determinism (same seed twice, byte-equal grid); (b) no class outside land except water;
(c) mangrove only within `mangrove_band` of a tidal shore; (d) class shares inside the band below. Mutation: set
`mangrove.band: 0` and expect (c)/(d) red.

## Metric band
| Metric | Reference | Source | Status |
|---|---|---|---|
| Tree/forest share of land, built-up share, mangrove/wetland share | **TBM** from WorldCover window (lat 8.9-9.4, lon -80.0..-79.3) | ESA WorldCover 2021 (CC BY 4.0) | needs COG reader approval |
| Urban share (corridor window) | OSM urban landuse 45.9 km2 of 412 km2 land = 11 % (incomplete: informal areas unmapped) | `real-geography.md` | lower bound |
| Wetland/tidal flats, south-east shore | 15.7 km2 in 18 polygons | `real-geography.md` (OSM ways only) | lower bound |
Until WorldCover is baked, band = `[0.5 x, 1.5 x]` of the OSM figures for built/wetland, jungle share unbanded (guard (a)-(c) only).

## Kept / replaced
Kept: coast distance code, `land_use` park/court of blocks (layer 8). Replaced: the flat `landMesh` plane and grey blocks outside
the active area as the only far ground.
