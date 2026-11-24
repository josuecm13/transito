# Map conventions

`world.yaml` is the source of truth. This file explains how to read it.

## Coordinate system

- Units: **meters**.
- Origin `(0, 0)`: **south-west corner** of the map.
- `+x` = east, `+y` = north. Elevation is `z` (meters above sea level).
- Bounds: `x ∈ [0, 6000]`, `y ∈ [0, 8000]` → **48 km²**.

## Two layers: budget vs. geometry

- **`grid`** is an **area budget**, nothing more. It says which district owns roughly which km².
  It is never drawn and no border in the game follows a grid line.
- **`geometry`** is what the player sees: the coastline (`land`), the irregular
  `playable_boundary`, `islands`, and `routes`. District borders in the final map follow roads,
  rivers, ridges and shorelines.

## Why the map won't read as a rectangle

1. **The coasts are the shape.** The box's north and south edges are sea. The land is a bent
   isthmus with peninsulas (Colón, the old quarter, Punta Pacífica), bays (Limón Bay, the bayfront
   curve), and islands (the causeway islands, Galeta point).
2. **Land edges are natural barriers, not walls.** West: river, mangrove and steep jungle. East: a
   mountain ridge. Both are wavy lines (`playable_boundary`), and beyond them the terrain continues
   at low detail with haze, so the world never visibly ends.
3. **Nothing important is axis-aligned.** The canal runs diagonally; real OSM street networks are
   rotated and curved; the highway snakes over the ridge.
4. **Water edges are soft.** Boats can go out to the box edge, where haze and a current push them
   back. The box is never visible as a line.
5. **The in-game map is a cropped, tilted paper map** of the land silhouette, not a square tile.

## District grid (budget)

The budget is divided into 1 km × 1 km cells — 6 columns × 8 rows. Each cell is assigned the
**dominant** district it belongs to. Area per district = number of cells.

In `world.yaml` the grid is written as text, **north row first** (as it reads on screen):

```
row 0  (y 7000–8000)   S C C S S S
row 1  (y 6000–7000)   C C C J J S
row 2  (y 5000–6000)   L L L J J J
row 3  (y 4000–5000)   L L L L J T
row 4  (y 3000–4000)   G G L J T T
row 5  (y 2000–3000)   B G K K T T
row 6  (y 1000–2000)   B B K K E A
row 7  (y    0–1000)   S B K S E A
                       0 1 2 3 4 5   column (x = col × 1000)
```

Cell `(col, row)` covers `x ∈ [col·1000, col·1000+1000)`, `y ∈ [(7−row)·1000, (8−row)·1000)`.

## Area budget

| Code | District | km² |
|---|---|---|
| C | Colón and Atlantic port | 5 |
| L | Gatún Lake | 8 |
| J | Jungle ridge and transit corridor | 7 |
| G | Central canal (Gamboa, the cut) | 3 |
| B | Pacific locks and Balboa | 4 |
| K | City core | 5 |
| E | Costa del Este | 2 |
| T | Tito's corridor | 5 |
| A | Tocumen airport | 2 |
| S | Open sea (Caribbean / Bay of Panama) | 7 |
| | **Total** | **48** |

Playable land + lake: **41 km²**, about 85% of the GTA V reference figure of 48 km².

## Compression

Real-world distances are compressed non-uniformly:

| Zone | Ratio | Reason |
|---|---|---|
| City core, Costa del Este | ~1:3 | Most missions; street layout must stay legible |
| Tito's corridor, airport, Colón | ~1:4 | Dense but repetitive |
| Canal, lake, jungle | ~1:10 | Scenic, cheap to build, fast to cross |

## Geographic rule we keep on purpose

The canal's **Atlantic end lies west of its Pacific end** — true in reality, and preserved here
(Atlantic locks at x ≈ 500, Pacific locks at x ≈ 1400). Players who navigate by "Atlantic = east"
get it wrong.

## Streets

Street network model (issue #7). Data lives in `world.yaml` → `street_styles`; frozen reference
metrics live in `street-metrics.yaml`.

- **Avenues are hand-drawn.** `routes` of kind `arterial` / `highway` are fixed constraints: the
  generator never moves them; generated streets join them in T or X junctions.
- **Collectors, locals and alleys are generated** between the avenues, with widths from
  `street_styles.hierarchy` (same `{ width, sidewalk }` shape as `street_profiles`; alleys have no
  sidewalk). Each active-area land district picks a style:
  - `formal` — streamlines of a tensor field summed from basis elements (`grid` with an angle,
    `radial` around a point, `coastline` parallel to `geometry.land`), spaced per class by
    `spacing`.
  - `informal` — organic growth (segments grow, branch, snap to nearby nodes/edges, prune acute
    angles, spawn alleys), tuned by `growth`.
- **Blocks are derived**, never drawn: they are the faces of the planar street graph (after snap,
  merge, split at crossings, prune). Buildable area = block minus (half the street width +
  sidewalk) on each bordering street. Buildable area is split into parcels; each parcel fronts a
  street and gets a building.
- **Land use:** `land_use.park` / `land_use.court` are the fractions of a district's blocks that
  become parks / courts (green, no buildings). Each in [0, 1], sum < 1.
- **Deterministic:** same `street_styles.seed` + same spec → identical streets, blocks, parcels.
- **Realism is tested, not eyeballed.** Each district lists `reference` sectors: real places, as a
  lon/lat `bbox` or a `place` + `size_m` square, at most 2 km² unless pinned to an existing engine
  import by `import_area_id`. Their metrics (block size quantiles, dead-end / T / X node shares,
  intersections and street km per km², mean segment) are frozen in `street-metrics.yaml` with
  provenance (`import_area_id`, `bbox`, `place_name`, `km2`, extraction date, source, method,
  "© OpenStreetMap contributors"). The generated network must fall inside the `band` around its
  reference. A district may opt out only with `realism: exempt` plus a written `realism_reason`.
- **Real streets are never imported at runtime.** Reference sectors are measured offline from the
  `geospatial-reconstruction-engine` database (OSM); the game only reads the frozen numbers.
- **Refreshing the references:** `npm run references` (`tools/reference-sectors.mjs`) reads every
  `reference` sector, reuses the engine import whose id (`import_area_id`) or exact bbox already
  exists (no re-import), otherwise requests it (`POST /import-areas`, background, following its
  events), measures `map-data?mode=filter` with `src/world/street-metrics.ts` and rewrites only
  `references:` in `street-metrics.yaml` (`method: map-data`). Needs the engine running at
  `ENGINE_URL` (default `http://localhost:58000`); a second run with no spec change leaves the file
  byte-identical.

## Layers (map restart, layers 1-5)

Everything on top of the unchanged coastline (`geometry.land`, bounds, islands, grid) is generated in
layers. Layer N reads only the outputs of layers < N (enforced by `tests/layers-contract.test.ts`, a static
import scan of `src/world/layers/`). Layers 1-5 cover the whole isthmus on a coarse grid
(`relief.grid.far.cell`, 16 m, same origin as the active area's 4 m grid); layers 6-9 stay in the active area.

| # | Layer | world.yaml section | Code (layers 1-3 generated; 4-5 skeletons) |
|---|---|---|---|
| 1 | Land cover / jungle | `land_cover` | `src/world/layers/layer1-land-cover.ts` |
| 2 | Relief | `relief` (+ `ridges`, `grid.far`) | `layer2-relief.ts` |
| 3 | Rivers, canal, Gatún Lake, locks | `rivers`, `canal`, `water_bodies` | `layer3-water.ts` |
| 4 | Airports | `airports` | `layer4-airports.ts` |
| 5 | Main roads | `main_roads` | `layer5-main-roads.ts` |
| 6-9 | Secondary roads, streets, blocks, buildings (active area) | `street_styles`, `blockout` | existing generators |

`runLayers(spec)` in `src/world/layers/index.ts` runs 1-5 in order. Each layer is a pure function
`(spec, outputs of earlier layers) => LayerNOutput`; no I/O, clock or `Math.random`. The outputs are stubs
(`generated: false`) until the generators land (layers 1-3 are generated; 4-5 are still stubs). Layer 1b (cover refinement after relief and rivers, `land_cover.refine`)
is a read-time re-mask, not a new layer.

New sections (all parsed strictly by `parseWorldSpec`: an unknown key is an error; checked by
`python tools/render_map_preview.py`, which also draws them in `preview.svg`):

- `land_cover`: class list, tidal shores (rects) with a mangrove band, forest density and noise, authored
  settlement discs, the 1b refine thresholds and the planned urban / wetland shares (OpenStreetMap figures,
  no new dependency; validator estimates them on a 100 m sample).
- `rivers`: authored outlets only. Each `mouth` must be a shoreline point of `geometry.land` (within
  `mouth_tolerance`), or, with `outlet: { water_body: <lake id> }`, a point of that lake's shore (a lake-fed river:
  `rio-chagres` feeds Gatún Lake). Optional `guide` points are low-cost corridors, not polylines to copy: the
  course is derived (layer 3, `layer3-water.ts`): priority-flood fill + D8 flow and accumulation on the 16 m far grid,
  a least-cost trace from the last guide to the mouth (guide corridor, stream preference, climb penalty), a bed
  that is monotone non-increasing source to mouth (running minimum), Leopold-Maddock width `w = a sqrt(A)`
  capped by `max_width`, depth `0.3 w^0.8`, banks 1:4, bed rising to the water level at the mouth so the shoreline stays at 0.
- `canal`: `route` (a waterway route = centreline) widened to `width`; locks sit at lock landmarks with real
  305 x 34 m chambers (`steps` = chambers in the flight: water level `sea + (lake - sea) k / steps`, k = 1 at the sea side);
  `bridge_landmarks` must lie on the channel. The land polygon is not cut. Heights: sea reaches at `sea_level`, the
  stretch between the two flights at `lake_level` (12 m), channel bed 8 m under its water, lock flights on an apron
  plateau 1.5 m above the lake level (grey blockout walls), banks cut at 1:3.6 into the relief.
- `water_bodies`: Gatún Lake and its canal inlet as interior water; polygons must lie inside `geometry.land`,
  and no hand-drawn route (except waterways) may cross them. The lake is a basin dug into H0 (floor 0.8 m under
  the level at the shore, 6 m at 200 m in), flat surface at `lake_level`, banks rising 1:3.6 outside; `islands`
  (seed, count) are generated inside the lake, off the shipping channel, summits 3-9 m above the water.
  The polygon's south end stops short of the Gatún lock flight (flight centred on its landmark).
- `airports`: Tocumen, two 1,500 m runways (routes of kind `runway`), terminal and cargo landmarks, the
  `relief.flatten` zone. Albrook airfield is not built.
- `main_roads`: authored node chains for Interamericana, Transístmica, Corredor Sur and Cinta Costera
  (boulevard + reclaimed park strip + bay-side viaduct), plus params (max grade, bridge and viaduct rules).
  A road may cross water only under a declared `bridges` entry or as a `structure: viaduct`. No Corredor Norte.
- `relief.ridges`, `relief.grid.far`: whole-isthmus ridges and the 16 m far grid (read by `terrain.ts` since layer 2).

Old fields these supersede (they keep working now; the switch happens when the layer is implemented in I2/I3,
and the old entries are then removed):

| Old | Replaced by | Note |
|---|---|---|
| `routes.corridor-avenue` | `main_roads` road `interamericana` | planned removal |
| `routes.transisthmian-highway` | `main_roads` road `transistmica` | its city end (Miguelito to the city) is carried by the Interamericana; the Transístmica now ends at the corridor junction (planned removal) |
| `routes.coastal-avenue` | `main_roads` road `cinta-costera` | planned removal |
| `routes.canal` (line only) | stays as the centreline of `canal` | kept |
| `routes.runway-1/2` | stay, referenced by `airports` | kept |

## Procedural isthmus (`procedural:`)

Inputs of the procedural generator (`src/world/proc/`, `npm run isthmus` renders `.cache/isthmus.png`).
They are coarse intent only; every shape is derived from them and `geometry.land`. Until the game
reads this map (#12), the authored layers above stay in use and the two coexist.

| Key | What it steers |
|---|---|
| `cell` | default generation grid (m); `generateIsthmus(spec, { cell })` can override it |
| `relief` | uplift `zones` (`line`: polyline + width, `disc`: centre + radius; `rate` scales the uplift), noise modulation, coast taper, stream-power `erosion`, `peak` height, sea floor and the inland `hummocks` that become lake islands |
| `lake` | the reservoir: `dam_hint` (snapped to the largest drainage area within `snap_radius`) flooded up to `target_km2` |
| `rivers` | smallest drawn drainage area and width per √km² |
| `canal` | sea points at both ends, the Pacific locks hint, channel width / depth, excavation weight |
| `airport` | search `hint` and `radius`, runway size and spacing, apron, the side the terminal faces (`towards`) |
| `roads` | grade costs per kind, bridge / causeway / canal-bridge / reuse multipliers, named `stops` and the `routes` that join them |
| `suitability` | where towns may build: slope, height band, coast preference, river crossing |
| `towns` | growth tuning and `items`: each town has `seeds` **or** `seed_along: { route, from }` (seeded along that road from its stop towards the route's end, growing only near that stretch), and a `target_km2` |
| `cover` | beach, mangrove, clearings and high forest thresholds |
| `transit` | named `stops` and the metro / rail `lines`; each branch is a list of stop ids |

Stops are named, not inlined. `airport-terminal` is reserved: it means the generated airport's
terminal and may not be defined as a stop. Every key is strict (unknown keys are errors) and the
same rules are checked by `parseWorldSpec` and `tools/render_map_preview.py`.

## Naming

Until open question #3 is decided, places use working names; the real place that inspired each one
is recorded in `inspired_by`.

## Streaming (for later)

Engine chunks are 250 m tiles → 24 × 32 = 768 tiles. Chunk ids derive from coordinates; districts
are metadata on tiles, not load units.

## Fragments

Real-place inspiration, measured offline (never imported at runtime). `npm run geo -- <search |
import | register | profile | status>` (`tools/geo-fragments.mjs`) drives the
geospatial-reconstruction-engine: small squares (default 800 m, at most 2 km²) are registered in
`specs/map/fragments/index.yaml` and profiled to `specs/map/fragments/<slug>.yaml` (streets, road
classes, buildings with a `data_quality` note, block fill fingerprints, relief slope distribution,
POIs; provenance and "© OpenStreetMap contributors" included). Streets use the same definition as
`street-metrics.yaml`. Workflow and translation rules: skill `map-from-reality`.
