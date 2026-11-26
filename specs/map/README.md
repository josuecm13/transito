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

## Human scale

Distances are compressed; the human-sized measures are **not**. `scale:` in `world.yaml` holds them
once, and every generator and test reads them from there (parser: `parseScale` / `checkScale` in
`src/world/spec.ts`, pure helpers in `src/world/scale.ts`, mirror: `check_scale` in
`tools/render_map_preview.py`, guard: `tests/scale.test.ts`).

| Key | Value | Rule |
|---|---|---|
| `human` | 1.8 m | Tito's height; `TITO_BODY` in `src/sim/body.ts` must match |
| `storey` | 3 m | floor-to-floor. Generated buildings are whole storeys: frontage lots draw 1–2, parcel buildings round their drawn height to whole storeys inside the district's `height` range (a range holding none is an error). Replaces `frontage_lots.level_height` |
| `door` | [0.9, 2.1] m | a storey must fit a door |
| `lane` | [3.0, 3.75] m | each `traffic` kind and every `street_styles.hierarchy` class (and any route with its own `width`) holds a whole number of lanes |
| `sidewalk_min` | 1.5 m | a sidewalk is 0 (none) or at least this wide |

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

## Layers (retired)

The authored layer pipeline (land cover, relief, rivers, airports, main roads) was retired in #12 2.5
(cards F5 and the follow-up cleanup, 2026-11-24). The game runs on the procedural map (`procedural:`,
`src/world/proc/`, adapted by `game-world.ts` and `game-spec.ts`). The sections `land_cover`, `rivers`,
`water_bodies`, `airports` and `main_roads` were removed from world.yaml, from `parseWorldSpec` and from
`tools/render_map_preview.py`; git history has them (commit be4ad0f and before).

What stays, parsed strictly (an unknown key is an error) and checked by `python tools/render_map_preview.py`,
which also draws it in `preview.svg`:

- `canal`: `route` (a waterway route = centreline) widened to `width`; locks sit at lock landmarks with real
  305 x 34 m chambers (`steps` = chambers in the flight); `bridge_landmarks` must lie on the channel.
- `relief`: `relief.grid` is the only part the game reads; `relief.ridges` and `relief.grid.far` are still
  validated and drawn.
- `routes`: hand-drawn constraints (`canal`, `runway-1/2`, and the old avenues) stay as authored.

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
| `airport` | search `hint` and `radius`, runway size and spacing, apron, the side the terminal faces (`towards`); `grade_slope_max` (rise/run, default 0.35) and `grade_reach_max` (m, default 600): earth embankments around the levelled field, cut on the high side and fill on the low side, slope never above the limit; `grade_slope_max: 0` is the legacy fixed 150 m blend |
| `roads` | grade costs per kind, bridge / causeway / canal-bridge / reuse multipliers, named `stops` and the `routes` that join them |
| `suitability` | where towns may build: slope, height band, coast preference, river crossing |
| `towns` | growth tuning and `items`: each town has `seeds` **or** `seed_along: { route, from, reach? }` (seeded along that road from its stop towards the route's end, discounted near that stretch, and built only within `reach` m of it when set), and a `target_km2`; optional `road_affinity` and `patches` (unbuilt gaps from a noise field). `separation` keeps unbuilt ground between different towns, `airport_buffer` keeps towns off the airfield's surroundings |
| `districts` | optional; coarse district influence refined after towns and transit (never recomputes terrain, roads, towns or tracks). `D(p) = clamp(S·G·[Σ w·exp(-(d/σ)²)·(1+coast) + transit])`; tuning `transit_weight/sigma`, `coast_weight/sigma`, `access_floor/range`, `footprint`, `airport_core_gap`, and `items: [{ id, style, sigma, weight, at \| along \| around }]` (`at` a point, `along` a road route, `around: airport`; `weight` in [-1, 1], negative pushes density away). Empty `items` = off, the map is exactly the towns + transit result. Styles are metadata for #7 (`historic-core`, `bayfront-linear`, `tower-cluster`, `hillside-lowrise`, `ribbon`, `port`, `buffer`). Presets live in `src/studio/presets.ts`; the studio adds them with `add-district` |
| `trails` | optional list (by `id`) of hiking trails, footpaths not roads (card 3 of `docs/map-reshape/03-technical/12-sectors-and-streaming.md`, decision 3: at least one trail in the jungle near the airport). Each: `from: airport-terminal` (the reserved stop = the landside of the generated terminal), `to: { highest_within, margin, min_distance }` a RULE for the ridge viewpoint (the highest dry, unbuilt cell within `highest_within` m of the airfield, inside the Act 1 rect shrunk by `margin` m, at least `min_distance` m straight from the start; if the highest cannot be reached within `max_length` the next highest candidate, >= 150 m apart, is tried; never a coordinate), `width` (m), `max_grade` (rise/run; the router refuses steeper edges, water, the airfield (20 m fence), built cells and anything outside the Act 1 rect), `min_length` / `max_length` (m, routed). Routed with `leastCostPath` at cost `len (1 + 2 (grade / (max_grade / 2))²)`; the path keeps the routed cell centres. Output `Isthmus.trails` (`src/world/proc/trails.ts`), drawn dashed dark green by `npm run isthmus`, own hash `hashes.trails`; empty or absent = the map and every hash (`all` included) are unchanged. Guard `trail-connected-and-grade`. Spec + route only: the game's walk graph, meshes, minimap and physics do not read it yet |
| `cover` | beach, mangrove, clearings and high forest thresholds |
| `transit` | named `stops` and the metro / rail `lines`; each branch is a list of stop ids |
| `act1` | Act 1 placement, derived from the generated map (#12 2.2): Tito's barrio is centred at `anchor_at` of the track of `line`'s one branch ending at `branch_to`, with `barrio_radius`; the Act 1 strip is that track from the anchor to the branch end, `strip_half_width` each side. `town` is the town the barrio must belong to (reported as a share of built cells). No coordinates: when the line moves, Act 1 moves with it (`src/world/proc/act1.ts`, `Isthmus.act1`) |
| `landmarks` | Act 1 and airport landmarks placed by rule, never by coordinates (#12 2.3): `anchor` (the act1 anchor), `{ along: m }` (that far along the act1 strip), `{ steepest_within: m }` (the steepest built cell of the act1 town that close to the anchor), `{ airport: terminal \| apron }`, and for bridges `{ on: crossing, route, feature: canal, tolerance: m }` (card 2 of sectors-and-streaming: the point where the generated `route` first crosses the generated canal centreline, on the road centreline = the deck, `heading` along the road in degrees [0, 180); the landmark follows the crossing when the road or canal moves; guard `bridge-landmarks-on-crossing` keeps it within `tolerance` m; `route` must be a `roads.routes` id, `feature` is `canal` only; `arch-bridge` uses it, `cable-bridge` keeps its authored spot because no generated road crosses the canal there, see the doc). Town spots snap to the nearest built cell of the act1 town. Output `Isthmus.landmarks` (`src/world/proc/landmarks.ts`). The `x`/`y` in `landmarks:` keep driving the current game until #12 2.5 |

### Map Studio edits (`procedural-edits.json`)

`world.yaml` stays the hand-readable source (comments included). The Map Studio (#13, `map-studio.html`, `tools/map-studio.ts`)
saves its changes to `specs/map/procedural-edits.json`: `{ "version": 1, "edits": [{ "path", "value" }] }`, a sorted list of
differences from `world.yaml`'s `procedural:` section (paths like `procedural.towns.items[id=la-ciudad].target_km2`). The
studio, `tools/render-isthmus.ts` and `tools/bake-isthmus.ts` apply it on top of `world.yaml` (`src/studio/saved.ts`); it is a
bake input, so saving rebakes the game's map. No file = the authored map. The `world.yaml` schema itself is unchanged.
Protocol and controls: `docs/map-reshape/map-studio-protocol.md`.

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
