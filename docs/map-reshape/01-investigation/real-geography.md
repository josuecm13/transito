# 01 — Real macro geography (measured)

Measured with `tools/probe-macro-relief.mjs` (re-runnable, cached tiles in `.cache/`, outputs in
`assets/macro-summary.json`, `assets/macro-isthmus.png`, `assets/macro-corridor.png`).
Data: AWS Terrain Tiles (Mapzen terrarium; SRTM, etc.) and © OpenStreetMap contributors (ODbL).
Nothing here is imported at runtime; it feeds spec decisions only.

## TL;DR

- The real corridor is a **flat coastal apron backed by a hill wall**: 17 % of Act 1 land is < 10 m
  and 34 % < 30 m, but only 13 km² of it is flat enough (< 2 % slope) to be a true plain. The 30 m
  contour sits 5-9 km inland; the 100 m contour 6-14 km inland.
- Towns are **not** confined to the flat apron: the OSM urban mask has a median slope of 7.9 %
  (p90 20.7 %), almost the same as all land (9.6 % / 27 %). Only 21 % of urban cells exceed 15 %
  slope (31 % of non-urban). San Miguelito sits on 59-73 m ground, 13-23 % local slope.
- **Rivers are the real separators inside the corridor**, not ridges: D8 on the 19 m grid
  reproduces Río Juan Díaz (84 % of its OSM course within 300 m), Tocumen (90 %), Tapia (82 %),
  Las Lajas (97 %), Abajo (97 %), Matías Hernández (94 %), Curundú (91 %). Cabra only 55 %.
- Seven rivers cross the corridor roughly N→S at 2-5 km spacing, each in a 10-25 km² basin; the
  east (Tocumen / Cabra / Tapia) drains into one 190 km² estuary of mangrove and tidal flats.
- The wall north of the corridor is real but modest: 150-450 m hills (Cerro of 453 m at
  -79.444, 9.135), then the Cerro Jefe massif (about 1000 m) 14 km north of the airport.
- The current spec has the canal, a highway, and one hill (San Miguelito). It has **no rivers,
  no mangrove or wetland, no drainage, and no real lowland band**: relief is rolling noise.
- Biggest mapping fact: the spec's corridor is a vertical strip, the real one runs ENE. A
  similarity fit of four landmark pairs gives **1:6.3 and a 63 deg clockwise rotation** (residual
  105-224 m), so the corridor is real-W→E laid out as map-N→S.

## Method and data quality

| Item | Value |
|---|---|
| Scale A grid | z10, 511 x 369 cells of 151 m, bbox lon -80.00..-79.30, lat 8.90..9.40 (3 921 km² land) |
| Scale B grid | z13, 1 341 x 1 004 cells of 18.9 m, bbox lon -79.56..-79.33, lat 8.98..9.15 (412 km² land) |
| Heights | terrarium: R*256 + G + B/256 - 32768. PNG decoded with node:zlib (no deps) |
| Sea | cells <= 0.5 m **connected to the frame**. SRTM reads tidal flats and mangrove as 0 m, so they count as sea here (the < 10 m land figures therefore exclude the 0 m flats; OSM wetland is reported separately) |
| Slope | central differences, rise/run in % |
| Flow | Barnes priority-flood from sea + frame (fills pits, gives a direction on flats), D8, accumulation |
| Streams | accumulation >= 25 km² (A) / 1.5 km² (B): 428 km / 210 km of channel |
| Ridges | basin divides between basins >= 80 km² (A) / 8 km² (B), 152 / 114 km; local maxima in a 6 km / 1.5 km window. A "steepest-ascent accumulation" ridge overlay was tried and is noise; use the divides |
| OSM | 3 Overpass queries, cached: named rivers/canals/streams, nature + places + motorway/trunk, landuse polygons (ways only; relations are skipped, so large mapped areas may be missing) |

Checks and known artifacts:

- **Height cross-check.** The z13 grid against the six Panama fragment profiles in
  `specs/map/fragments/` (engine elevation stats, same AWS source): p50 within 1 m
  (Juan Díaz 7 vs 7.4, Pedregal 36 vs 36.1, Tocumen 36 vs 36.5, Las Mañanitas 55 vs 55,
  Samaria 59 vs 58.5, Torrijos-Carter 72 vs 71.9); min and max also within 2 m. It is a
  consistency check of the same dataset, not an independent survey. z10 (scale A) is blunter
  (Samaria p50 63 vs 58.5), as expected at 151 m.
- Flats near the coast are noisy: D8 across SRTM mangrove produces straight, parallel streams
  (visible east of lon -79.38 in the corridor preview). Treat stream positions in the eastern
  estuary as unreliable and the < 10 m area as an upper bound.
- `la-carpio.yaml` is a Costa Rica fragment (lon -84.15, height about 970 m), not Panama; it was
  excluded from the check.

## Scale A: the isthmus (lon -80.00..-79.30, lat 8.90..9.40)

### Relief

| Metric | Value |
|---|---|
| Land height p10 / p50 / p90 / p99 / max | 26 / 97 / 402 / 730 / 1 101 m |
| Land slope p50 / p90 / p99 | 6.4 / 22.8 / 39.6 % |
| Share of land < 10 m / < 30 m | 4.6 % / 17.7 % (181 km² below 10 m) |
| Divide height p10 / p50 / p90 | 64 / 176 / 463 m |

The lowest crossing is the canal axis (Gatún Lake surface about 26 m, flat), not a pass.

### Natural separators

| Feature | Real position (lon, lat) | Size | Role |
|---|---|---|---|
| Panama Canal / Gatún Lake | axis -79.92, 9.27 (Gatún) to -79.59, 8.99 (Miraflores) | OSM names: Canal de Panamá, Antiguo Canal Francés, Banana Cut; lake 26 m flat, visible as the large flat in the preview | Splits west from east; its Atlantic end is west of the Pacific end |
| Continental divide | median 176 m, 152 km of divide between the large basins | 100-460 m crests | Caribbean/Pacific split, north-east of the lake |
| Cerro Jefe massif | -79.384, 9.230 (OSM 1 007 m; probe 994 m) | about 1 000 m, 25 km north of Panama City | The wall north-east of the corridor; maps to the east edge (x >= 5 700), y about 5 700 |
| Cerro 1 101 m | -79.810, 9.241 | highest cell in A | North-west, beyond the lake |
| Cerro Cabra | -79.639, 8.910 (OSM 504 m) | south-west of the canal mouth | Pacific side relief |
| Cerro Ancón, Cedro, Sosa, San Juan Hill | -79.55..-79.58, 8.95..9.00 (83-155 m) | small | City-edge hills (Casco / Albrook) |
| Chagres / Gatún basin | mouth -79.914, 9.339 | 2 238 km² (merged through the lake) | The Caribbean-side trunk; Río Chagres 81 %, Gatún 70 % reproduced |
| Pacific basins | Panama Viejo shore (-79.558, 8.937, 244 km²); Juan Díaz / Abajo (-79.457, 9.012, 150 km²); Pacora side (-79.300, 9.049, 204 km²); frame basins west of the canal | 100-250 km² | The city side of the ridge |
| Bahía de Limón | -79.92, 9.36 | open bay, Colón peninsula | Caribbean anchor |
| Bahía de Panamá | south of lat 8.95 | open, shallow | Pacific anchor; tidal flats along its east shore |

### Highways and towns (OSM)

Corredor Norte (motorway), Corredor Sur (motorway), Autopista Panamá-Colón (motorway; the
Transístmica), Carretera Panamericana (trunk/motorway), Vía Centenario, Cinta Costera, Avenida
Balboa, Puente de las Américas, Autopista Arraiján-La Chorrera. All sit on the narrow Pacific
apron or follow the Chagres/Gatún valley north; none crosses the 400 m hills.

### Real isthmus versus the spec (mapping used)

The spec compresses non-uniformly. Anchor pairs (spec landmark to real place) used for the
mapping, with ratio to real distance:

| Axis / zone | Real | Spec | Ratio |
|---|---|---|---|
| N-S, Casco Viejo (8.953) to Colón (9.359) | 45 km | 6 650 m (y 400 to 7 050) | about 1:6.8 |
| Atlantic locks to Pacific locks (Gatún to Miraflores) | 31 km N-S, 33 km E-W | 5 000 m N-S, 900 m E-W | about 1:6 N-S, 1:37 E-W |
| Colón to Casco Viejo, E-W | 40 km | 650 m | about 1:60 |
| Corridor, Samaria to Tocumen terminal | 12 km | 2 000 m | about 1:6 (spec says 1:4) |

Conclusion: the spec stacks the isthmus **north-south** and folds the east-west run of the
real city into a vertical strip. That is deliberate (a 6 x 8 km box) but it means real
distances cannot be scaled uniformly; each separator needs a local placement rule.

## Scale B: the Act 1 corridor (lon -79.56..-79.33, lat 8.98..9.15)

### Relief

| Metric | Value |
|---|---|
| Land height p10 / p25 / p50 / p75 / p90 / p99 / max | 5 / 17 / 58 / 122 / 198 / 380 / 505 m |
| Land slope p10 / p50 / p90 / p99 | 2.7 / 8.4 / 26.5 / 45.7 % |
| Land < 10 m | 16.8 % (69 km²); only 13 km² of it with slope < 2 % |
| Land < 30 m | 33.7 % |
| Drainage | 210 km of stream at >= 1.5 km², about 0.5 km/km² |

Inland distance from the sea to a height contour, along meridians (m, noisy where the
mangrove reads as 0 m):

| lon | coast lat | to 10 m | to 30 m | to 100 m |
|---|---|---|---|---|
| -79.54 | 8.980 | 0 | 472 | 5 378 |
| -79.50 | 8.983 | 434 | 4 812 | 8 643 |
| -79.46 | 9.010 | 302 | 5 076 | 11 662 |
| -79.44 | 9.013 | 623 | 6 812 | 10 454 |
| -79.42 | 9.015 | 3 340 | 5 133 | 10 266 |
| -79.40 | 9.006 | 2 189 | 9 001 | 11 851 |
| -79.38 | 9.020 | 264 | 7 303 | 10 737 |
| -79.34 | 9.023 | 6 699 | 8 624 | 13 681 |

Reading: a 5-9 km apron below 30 m, a gentle rise to 100 m by 10-12 km, then the hill wall.
At 1:6.3 that is 0.8-1.4 km of "plain" and 1.7-2.2 km to the 100 m rise in the map.

### Natural separators

Positions map to spec meters with the corridor fit below; reliable only inside the corridor.

| Feature | Real (lon, lat) | Map (x, y) | Length / size | D8 reproduces |
|---|---|---|---|---|
| Río Abajo | mouth about -79.49, 9.00 | about (3 800, 2 750) | 13.1 km in B, basin 23 km² | 97 % |
| Río Matías Hernández | Panamá Viejo shore | about (3 700, 2 850) | 9.2 km, basin 24 km² | 94 % |
| Río Curundú | west edge | outside | 4.9 km | 91 % |
| Río Juan Díaz | mouth -79.455, 9.012 | about (4 200, 2 375) | 21.7 km, basin 21 km² | 84 % |
| Río Tocumen | joins the Tocumen estuary | about (5 240, 900) | 20.9 km | 90 % |
| Río Tapia | joins the same estuary | about (5 240, 900) | 18.7 km | 82 % |
| Río Las Lajas | north of Tocumen | north edge | 16.9 km | 97 % |
| Río Cabra | east, near -79.34, 9.05 | east edge | 24.9 km | 55 % |
| Río Cabuya | east | east edge | 14.0 km | 74 % |
| Tocumen / Cabra / Tapia estuary | mouth -79.354, 9.026 | about (5 240, 900) | basin 192 km² (merged by D8) | n/a |
| Tidal flats and mangrove (OSM wetland) | south shore, lon -79.46..-79.33 | south-east, y < 1 400 | 15.7 km² in 18 polygons, 48 % below 10 m | n/a |
| Hill wall north | peak 453 m at -79.444, 9.135 | (6 236, 3 197), past the east wall | 150-450 m | n/a |
| San Miguelito / Samaria hills | peaks 264 m (-79.533, 9.061), 236 m (-79.520, 9.049) | (4 354, 3 976), (4 280, 3 684) | 150-260 m domes over 59-90 m ground | n/a |
| Cerro Cedro (OSM 155 m) | -79.549, 8.996 | outside | small hill, west edge | n/a |
| Corredor Norte / Sur (OSM) | arc along the 30-50 m contour, apron to the north | n/a | motorway | n/a |

Not in B: Río Pacora (east of -79.33). Channel widths are not in the data and were not
measured; OSM gives centerlines only. Small named streams (Quebrada Las Mañanitas 13 %,
Quebrada Iguana 0 %, Rio Sierpre 4 %) are not reproduced: basins under 1.5 km² or altered channels.

Corridor fit used for the map columns (`assets/macro-summary.json` -> `mapping`):
`e=(lon+79.5)*111.0*cos(9.05)*1000`, `n=(lat-9.05)*111.0*1000`; map = scale 0.160 (1:6.3), rotated
-63 deg (clockwise) about the real centroid (e, n) = (6 413, 763) m mapped to (5 025, 2 525).
Anchors and residuals: Samaria to miguelito-hills 105 m, Juan Díaz to corridor-market 224 m,
Pedregal to tito-home 171 m, Tocumen terminal to passenger-terminal 118 m.

### Where towns sit (OSM landuse mask and place nodes)

| Population | Area | Height p10 / p50 / p90 | Slope p10 / p50 / p90 | Share slope > 15 % |
|---|---|---|---|---|
| OSM urban landuse (1 383 polygons) | 45.9 km² | 9 / 43 / 126 m | 2.7 / 7.9 / 20.7 % | 21 % |
| All other land | 366 km² | 5 / 61 / 210 m | 2.7 / 9.6 / 27.0 % | 31 % |

The landuse mask is incomplete (ways only, informal barrios often unmapped), so the real
contrast is probably sharper. Settlement is still not a flat-only phenomenon.

| Place | Height | Local slope | Spec position (x, y) |
|---|---|---|---|
| Juan Díaz | 17 m | 5.9 % | (4 788, 2 455) |
| Pedregal | 38 m | 3.7 % | (5 395, 2 422) |
| Las Mañanitas | 48 m | 5.9 % | (5 899, 2 233) |
| Tocumen | 37 m | 3.7 % | (6 057, 1 877) |
| Nuevo Tocumen | 16 m | 7.5 % | (6 285, 1 362) |
| Belén | 21 m | 5.3 % | (5 803, 1 977) |
| 24 de Diciembre | 34 m | 13.2 % | (6 314, 1 637) |
| Cerro Viento | 28 m | 5.3 % | (4 966, 2 776) |
| San Miguelito | 59 m | 13.2 % | (4 583, 3 318) |
| Samaria | 71 m | 22.6 % | (4 512, 3 301) |
| Torrijos Carter | 73 m | 10.9 % | (4 965, 3 474) |
| Alcalde Díaz | 139 m | 19.3 % | (5 188, 4 565) |
| Río Abajo | 16 m | 3.7 % | (4 076, 3 064) |

Pattern: old/formal districts (Juan Díaz, Pedregal, Tocumen, Belén) sit on 4-6 % ground at
17-48 m; informal hill barrios (Samaria, San Miguelito, Alcalde Díaz) on 13-23 % at 59-139 m.
Tocumen, Nuevo Tocumen and 24 de Diciembre lie on the edge of the mangrove flats. Several map
positions fall outside x 4 000-6 000 (Tocumen at x about 6 057): the fit places the real corridor
further east and south than the spec's active rect, another sign the spec layout is stylised.

## What `specs/map/world.yaml` represents today

| Real feature | In the spec? | Notes |
|---|---|---|
| Canal, locks, Gatún Lake, Limón and Panama bays | Yes | route + districts + water labels |
| Transístmica / highways | Partly | `transisthmian-highway` over the ridge; no Corredor Norte/Sur |
| West and east land edges | Yes, as text | `playable_boundary` west "river-and-mangrove", east "ridge-and-jungle"; neither exists as terrain |
| San Miguelito hills | Yes | one authored hill, uplift 38 m + noise, radius 1 000 m |
| Rolling corridor terrain | Yes, noise | `relief.rolling`, 19 m amplitude, 380 m wavelength |
| Coastal apron (< 30 m, 5-9 km deep) | Weakly | ramp 0.4 % to 14 m plateau, so the apron is much shorter than real |
| Rivers (Juan Díaz, Tocumen, Tapia, Abajo, Cabra...) | **No** | no waterway except the canal |
| Mangrove / tidal flats / wetland | **No** | only `costa-del-este` cap 3 m |
| Basin divides / drainage | **No** | terrain is not hydrologically consistent |
| Hill wall north of the corridor | **No** | corridor is a box with grey edges |
| Cerro Jefe massif | **No** | far outside the map |

## Implications for the reshape

- **Rivers first.** Add 5-7 N→S streams across the corridor, 2-5 km apart in real terms
  (0.3-0.8 km in the map at 1:6.3), each with a 10-25 km² basin and a mangrove mouth. They are the
  strongest natural town separators in the real data and the spec has none.
- **Derive them, don't draw them.** A priority-flood + D8 pass on the spec's own height field
  reproduces 84-97 % of the real rivers on real terrain; run the same utility on the synthetic
  relief so towns and rivers agree (basin = district candidate).
- **Re-shape the apron.** Real flat land is a 5-9 km band below 30 m; at 1:6.3 that is
  0.8-1.4 km. The current ramp (0.4 % to 14 m) is the right order but has no estuary; the
  Tocumen / Cabra / Tapia estuary (15.7 km² of OSM wetland, 192 km² basin) is the natural east
  separator and the place for the airport shore.
- **Do not confine towns to flat ground.** Real urban cells have p90 slope 21 %; informal barrios
  sit on 13-23 % at 60-140 m. Suitability should penalise slope > 25 % and flooding below 10 m,
  not require plain terrain.
- **North wall is a 150-450 m hill band** (peak 453 m at the north edge), not the Cerro Jefe
  massif. Keep it as the corridor's north separator with a haze skirt beyond.
- **Corridor orientation.** The spec strip is ENE in reality. Choose a rotation (the fit says
  63 deg) and keep it for rivers and ridges, otherwise N→S rivers will cross the strip as
  parallel bands.
- **Compression is per-axis.** Colón-Panama is 1:6.8 N-S but 1:60 E-W; a uniform scale cannot
  place Gatún, Gamboa and the airport. Use anchor-based piecewise mapping (see `isthmus_anchors`
  in the summary) or relocate by landmark.
- **Reuse the heights, not the scale.** Real heights are right to 1 m (cross-check) but the map
  compresses 1:4-1:6, so keep real slopes (p50 8 %, p90 26 %) and let heights scale, as the
  relief spec already does.
- **Tests worth adding** once utilities exist: share of land < 10 m in the Pacific apron
  (target 17 % +- band), river reproduction on real terrain (>= 80 %), urban slope p90 (about 21 %).

## Reproduce

```
source ~/.nvm/nvm.sh && nvm use 22      # Node >= 18 (global fetch)
node tools/probe-macro-relief.mjs        # both scales; --scale A|B, --no-osm
```

Needs network on the first run only (tiles in `.cache/macro/`, gitignored). Overpass is polite:
User-Agent `transito-probe`, 3 queries, cached.
