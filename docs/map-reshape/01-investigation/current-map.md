# 01 — Current map: where the rectangle lives and what a reshape can build on

Snapshot of 2026-11-21, working tree as it was read (uncommitted work by other agents is marked **in flight**).
Metrics were computed with a throwaway script over `buildWorldData` (spec seed 1, 10 m sampling for areas,
20 m mask for sightlines); the street metrics are the printed output of
`node --test tests/streets-realism.test.ts tests/streets-informal.test.ts` (15/15 pass).

## TL;DR

The Act 1 segment is a rectangle in exactly one place of the data (`active_area.rect`, world.yaml:157-160), but that
one number is consumed by ten places (slice, walls, frame lines, street clipping, district boxes, terrain bake,
minimap, world map, validators, tests), and a *second* rectangle hides behind it: districts are unions of 1 km grid
cells, so district borders inside the segment are straight axis-aligned lines. The terrain-led pieces already exist
as data but do almost nothing for Act 1: `geometry.land` already gives an irregular coast (it removes 0.76 of the
8 km²), whereas `playable_boundary` is wired into code (walls, street frame, `isPlayableLand`, world map) but its east
line only clips 0.46 km² inside the rect and its west line lies 3.6 km outside, so the visible cuts of the segment are
still the rect's north and west edges (invisible 3 m collision walls, ground continues flat). There are no rivers
anywhere (only the 120 m `canal` waterway, 2.7 km west of the segment), no mountain separators, and the in-flight
relief model is a first terrain-led layer (0 to 67 m) that does not yet influence where streets or districts go.
Playable land is 6.78 km² with 126 km of streets and 10,490 buildings; the longest open chord is 4.2 km, but the
camera only ever shows about 350 m (fog 120-350 m), so perceived scale comes from the camera and the layout, not from
the rect.

## 1. Where the rectangle is baked in

| # | Place | file:line | What it does with the rect | What must change for an irregular, terrain-led outline |
|---|---|---|---|---|
| 1 | `active_area.rect` | specs/map/world.yaml:157-160 | The single source: `x:[4000,6000] y:[0,4000]`, spawn `tito-home` | Replace by a polygon (or a suitability-field mask + bbox). Keep a bbox for grid sizing. Validator must check spawn inside the polygon |
| 2 | Spec parse | src/world/spec.ts:497-509 | Parses `x`, `y` pairs into `ActiveArea` (only a pair of pairs) | New `ActiveArea` shape (polygon or mask ref); every consumer below reads `activeArea.x/.y` |
| 3 | Slice | src/world/slice.ts:31-33, 40 | `rect` built from `x,y`; landmarks filtered by `rectContains`; routes clipped with `clipPolylineToRect` | Clip routes and landmarks with a polygon test (`pointInPolygon` exists in geometry.ts:11); add polyline-vs-polygon clip (only rect clip exists, geometry.ts:69-125) |
| 4 | Walls | src/world/slice.ts:50-70 | Coast segments + both `playable_boundary` lines clipped to the rect, then the **4 rect edges** added as walls (16 segments total) | Walls come from the outline polygon; rect edges disappear. Walls are collision only, never drawn |
| 5 | `isPlayableLand` | src/world/slice.ts:72-80 | `rectContains` AND inside `geometry.land` AND between the west/east boundary lines (x at y, so only monotone-in-y lines work) | Single polygon/mask test. West/east as functions of y cannot express a ridge that bends back or a north/south cut |
| 6 | Physics ground | src/plugins/world-physics.ts:23-30 (in flight) | Was a cuboid over the rect; now a Rapier heightfield over the baked terrain grid (rect + margin) | Grid bbox follows the outline bbox; ground outside the outline is walled or sea |
| 7 | Terrain bake | src/world/terrain.ts:149-170; relief.grid in world.yaml (in flight) | Grid = rect expanded by `relief.grid.margin` 120 m, cell 4 m; landmark pads only inside the rect (terrain.ts:180-184) | Bbox of the outline; margin becomes the skirt; hills/flatten zones are authored in absolute coordinates so they survive |
| 8 | Street frame | src/world/streets/region.ts:41-77, 207-210 | Coast, limit and **area** (rect) frame segments go in the planar graph; `district` frames are grid cell borders (region.ts:62-77) | Replace `area` frame with the outline ring; replace `district` frames with real borders (river, ridge, road) |
| 9 | Street clipping | src/world/streets/generate.ts:265-275 (avenues), 765 (field avenues), 1012-1026 (`finishEnd` projects ends within 2 m of the rect onto its edge) | Avenues clipped to rect; growth ends at the rect snap to its straight edge | Polygon clip; `finishEnd` must project onto the outline edge, not min(dx,dy) of a rect |
| 10 | District regions | src/world/streets/region.ts:171-190, 205-211 | `districtBox` = bounding box of the district's grid cells clipped to the rect; `contains` = `districtAt` (grid cell) AND playable | District polygons (or a label field) replace the grid lookup `districtAt` (spec.ts:848+); box becomes bbox of the polygon |
| 11 | Style coverage rule | src/world/spec.ts:829-840 | Every land district with a grid cell overlapping the rect needs a street style | Same rule against district polygons |
| 12 | Blockout / buildings | src/world/streets/city.ts:51-; blockout.districts in world.yaml:259-290 | Per-district numbers keyed by district id; derived from blocks, so it follows whatever blocks the streets give (no rect use of its own) | Nothing, provided blocks come from the new outline. In flight: `frontage-lots` method (streets/frontage-lots.ts) for `tito-corridor` |
| 13 | Population spawn | src/sim/population.ts:28-54; src/world/world-data.ts:34 | Spawns on walk-graph edges in a ring around the focus; graph nodes filtered by `slice.isPlayableLand` | Nothing beyond #5; it is already outline-agnostic |
| 14 | Minimap | src/ui/minimap-layer.ts:27-50 | Static layer canvas = rect + 100 m margin, drawn once | Canvas bbox = outline bbox; mask pixels outside the outline (sea/grey) |
| 15 | World map | src/ui/world-map-canvas.ts:247-262, 270-301, 305-312 | Detail layer clipped to `slice.rect` (`g.rect` clip), hatching beyond `playableBoundary`, then **strokes the rect** as the active-area outline | Clip with the outline path; stroke the outline; the hatch logic (`beyond`) already exists and can be reused for "outside the segment" |
| 16 | Camera | src/plugins/camera-follow.ts:6-12, 21-37; src/engine/view.ts:33-35 | Follows the player, **no clamp, no rect use**; perspective 50 deg, distance 25 m, pitch 55 deg, fog 120-350 m, far 2000 | Nothing to unpick. Relevant limit: the player never sees beyond ~350 m, so the outline is only visible as a wall, not as a silhouette |
| 17 | Map validator | tools/render_map_preview.py:79-86, 186-190, 399-407 | Rect min<max, spawn inside rect, land districts with cells in rect, draws the rect and boundary lines on the SVG | Port the same checks to the polygon (Python mirrors the TS rules) |
| 18 | Tests that pin the rect | tests/slice.test.ts:21,36,42; tests/streets-informal.test.ts:53,121,184,202; tests/streets-realism.test.ts | `rectContains` on streets/walls, `x < minX` is not playable, band metrics measured `area: 'cells'` vs `'land'` | Re-express as "inside outline"; the realism band is computed per district over the cells' km², which changes when district areas stop being grid cells |

### The grid is a second rectangle

| Fact | Value | Source |
|---|---|---|
| Cells touched by the rect | cols 4-5 (x 4000-6000), rows y 0-4000 | world.yaml:17-25 |
| Ownership inside the rect | T (tito-corridor) x4000-6000 y2000-4000; E (costa-del-este) x4000-5000 y0-2000; A (airport) x5000-6000 y0-2000 | grid |
| Straight district borders in the segment | y=2000 (T over E/A), x=5000 (E | A), both axis-aligned, both become frame edges the street generator treats as walls | region.ts:62-77 |
| `target_km2` budget check | Python fails if cell counts differ from `target_km2` per district | render_map_preview.py:50-51 |
| `districtAt` | grid lookup, used by the generator, the validator and `contains` | spec.ts (`districtAt`) |

The README claims "district borders follow roads, rivers, ridges and shorelines, never grid lines"
(world.yaml:7); inside Act 1 the code does the opposite (region.ts header: "the grid is an area budget, so these are
provisional").

## 2. What a terrain-led reshape can build on

| Asset | Where | State today | Used by code? |
|---|---|---|---|
| `geometry.land` coastline | world.yaml:31-47 | 28 points, irregular Pacific shore (Costa del Este reclaim, airport shore). Inside the rect it makes a diagonal SE-to-NW sea edge | Yes: `isPlayableLand`, walls, street frame `coast`, relief shore distance (terrain.ts:149-156), world map |
| `playable_boundary` west | world.yaml:49-52 | `river-and-mangrove`, x 0-400 | Parsed (spec.ts:411-417), in walls/frame/`isPlayableLand`/world map. Outside Act 1 (3.6 km west of the rect): no effect |
| `playable_boundary` east | world.yaml:53-56 | `ridge-and-jungle`, x 5600-6000 | Same wiring. Inside the rect it only trims the strip x 5700-6000 at y 2200-3500: 0.46 km² (7.24 land minus 6.78 playable). The `barrier` string is **never read** by code, only stored |
| `shape_anchors` | world.yaml:63 | List of ids (canal, colon-peninsula, ...) | No: not referenced anywhere in src/ or tools/ (grep), documentation only |
| `islands` | world.yaml:58-60 | `causeway-islands`, `galeta-point` | Frame coast rings (region.ts:42); none in the rect |
| Routes by kind | world.yaml:128-155, 164-171 | highway, arterial, rail, waterway, road, runway. `BARRIER_KINDS` = runway, rail, waterway (region.ts:30): streets may not cross them | Yes. In the rect: `corridor-avenue` (arterial), `transisthmian-highway` (clipped, enters at about x4370 y4000, leaves at x4000 y3000), 2 runways. `coastal-avenue` ends at (4500,900) inside CdE |
| Landmarks | world.yaml:88-126 | 6 inside the rect (see section 3); pads in relief | Yes (triggers, pads, minimap) |
| **in flight** `relief:` + `src/world/terrain.ts` | world.yaml:291-345; terrain.ts (474 lines) | Pure height model: coastal ramp, rolling noise, authored hill `san-miguelito` (uplift 38 m at (4500,3400)), flatten zones (airport, costa-del-este cap 3 m), landmark pads, street grading (max grade 22 %), baked 4 m grid + heightfield for Rapier. Slope targets from real data (Samaria p50 16 %, Juan Diaz 4.5 %). Height on playable land: 0 to 67 m | Wired in world-data, physics, world-view (drape.ts, in flight). Streets do **not** read heights: grading adapts terrain to streets, never the other way around |
| **in flight** street seed | world.yaml:215-222; src/world/streets/seed.ts; specs/map/seeds/la-carpio.json | Real La Carpio fragment placed at (5000,2600), mirrored, rotated 40 deg, clipped to land/borders; growth continues from its rim | Informal generator only (tito-corridor) |
| **in flight** frontage-lots | world.yaml:262-282 | Building fill from the measured La Carpio fingerprint, per district `method:` | `streets/city.ts`, `frontage-lots.ts` |
| Fragments | specs/map/fragments/index.yaml + 8 profiles | Real 700-1200 m squares (Llano Bonito/Juan Diaz, La Carpio x2, Las Mananitas, Pedregal, Samaria, Tocumen, Torrijos-Carter) with engine import ids and slope/street fingerprints. Inspiration data, not geometry in the game | Terrain targets and the street seed only |
| Tensor-field streets | streets/tensor-field.ts, generate.ts:720-790 | Formal districts follow `grid`, `radial`, `coastline` elements. A `coastline` element already makes streets hug `geometry.land` | Yes (CdE, airport) |
| Street metrics bands | specs/map/street-metrics.yaml | Frozen real-sector bands (La Carpio, Santa Ana) the tests enforce | Yes |

## 3. Measured facts of the Act 1 segment

### Area (10 m sampling)

| Item | km² | Note |
|---|---|---|
| Rect | 8.00 | 2000 x 4000 m |
| Land inside `geometry.land` | 7.24 | sea in rect: 0.76 |
| Playable land (`isPlayableLand`) | 6.78 | 0.46 km² east of the playable boundary |
| tito-corridor (cells 4.00) | land 4.00, playable 3.59 | 3.59 km² = the realism test's `land` area |
| costa-del-este (cells 2.00) | land 1.48, playable 1.48 | 0.52 km² sea |
| airport (cells 2.00) | land 1.76, playable 1.71 | 0.05 km² past the east boundary |

### Streets and buildings (graph, spec seed 1, alleys counted)

| Class | km |
|---|---|
| local | 106.3 |
| collector | 13.0 |
| avenue (fixed routes) | 4.7 |
| alley | 2.0 |
| **Total** | **126.0** (about 18.6 km/km² over the whole playable land; the corridor alone is 18.3 km/km² by cells) |

| Metric | Value |
|---|---|
| Blocks (all districts, alleys included) | 567 |
| Parcels | 911 |
| Buildings | 10,490 (tito-corridor 10,125, costa-del-este 332, airport 33) |
| generateStreets time | cold 273 ms, warm median 162 ms |

### Printed realism metrics (tito-corridor, spec seed 1)

| Variant | blocks | median m² | p90 m² | dead ends | T | X | int/km² | km/km² |
|---|---|---|---|---|---|---|---|---|
| cells, alleys excluded | 240 | 7353 | 14942 | 25.8 % | 58.8 % | 15.4 % | 193.0 | 18.33 |
| land, alleys excluded | 240 | 7353 | 14942 | 25.8 % | 58.8 % | 15.4 % | 214.9 | 20.41 |
| cells, alleys included | 262 | 6537 | 14172 | 24.0 % | 60.9 % | 15.1 % | 200.0 | 18.80 |

Seed sweep 1-10: 9 of 10 inside the La Carpio band (seed 3 out by one metric). Costa del Este (formal): 174 blocks, median
5042 m², 19.7 km/km² by cells. Airport is realism-exempt. Blocks tile the corridor land exactly (sum 3,592,937 vs
3,592,940 m²), so the block generator already respects an irregular land mask.

### Act 1 landmarks (spec metres, straight line)

| Landmark | x, y | District |
|---|---|---|
| gated-community | 4500, 900 | costa-del-este |
| cargo-terminal | 5300, 1200 | airport |
| passenger-terminal | 5600, 1700 | airport |
| corridor-market | 4600, 2400 | tito-corridor |
| tito-home (spawn) | 5400, 2600 | tito-corridor |
| miguelito-hills | 4500, 3400 | tito-corridor |

| Pair | m | Pair | m |
|---|---|---|---|
| passenger-terminal / cargo-terminal | 583 | gated-community / corridor-market | 1503 |
| tito-home / corridor-market | 825 | gated-community / tito-home | 1924 |
| gated-community / cargo-terminal | 854 | miguelito-hills / passenger-terminal | 2025 |
| tito-home / passenger-terminal | 922 | miguelito-hills / cargo-terminal | 2341 |
| miguelito-hills / corridor-market | 1005 | gated-community / miguelito-hills | 2500 |
| miguelito-hills / tito-home | 1204 | tito-home / cargo-terminal | 1404 |

Home to market is 825 m straight; the mission loops fit inside a 2.5 km span. Everything in the Act 1 list is within
2.5 km of everything else, so any reshape that moves landmarks by more than a few hundred metres changes mission timing.

### Sightlines (flat terrain, buildings ignored, 20 m mask, 100 m origin grid, 3 deg rays)

| Measure | Value |
|---|---|
| Longest open chord inside playable land | 4,160 m, from (5900,300) at 117 deg (airport shore towards the NW corner) |
| Median of per-origin max chord | 3,030 m (p10 2,400 m, p90 3,710 m) |
| What the camera shows | about 350 m (fog 120-350 m, far plane 2000, pitch 55 deg, distance 25 m, camera-follow.ts:6-12, view.ts:33-35) |

With relief (0-67 m, in flight) the real open chords through San Miguelito hills (core radius 450 m, uplift 38 m) are
shorter than 4 km; they were not recomputed (the chord test above is planar). Buildings (10 k, 4-10 m high) shorten any
street-level sightline to the street canyon.

## 4. Gaps against the director's goals

| Goal | Today | Gap |
|---|---|---|
| Rivers | No river route kind; only `canal` (`waterway`, 120 m) at x 300-1500, 2.7 km from the segment. `waterway` is already a barrier kind with a profile, renderer colour (world-view.ts:58, minimap-layer.ts:21) and street exclusion | Add river routes (reuse `waterway` kind, narrower `width`) plus bridges; relief must carve a valley (nothing carves today) |
| Mountains that separate | Only one authored hill (`san-miguelito`, radial, 38 m uplift) at the NW of the corridor; the east boundary is labelled `ridge-and-jungle` but is only a line with a string | Ridge features (linear, not radial) in `relief.hills`, and street/district logic that stops at slope. No code uses slope to forbid streets |
| Relief decides town limits | District = grid cells. Streets ignore height (terrain grades itself to streets, terrain.ts header). Seed streets are clipped by land/borders only | Suitability field (slope, height, water distance) -> mask -> district/outline polygons; streets read the field |
| Segment edge behaviour | North edge y=4000 and west edge x=4000: 3 m high invisible collision walls (slice.ts:68-70, world-physics.ts:44-60), not drawn; land and street ends are cut flat; streets end projected onto the edge (generate.ts:1012-1026); the highway and avenue just stop at the wall; minimap crops at rect+100 m; world map strokes the rect and hatches beyond `playable_boundary` only. Beyond the baked terrain (120 m margin) the ground is the flat `landMesh` plane, hidden by fog | No natural stop. Edges need a physical reason (river, ridge, mangrove) and the roads need a destination (tunnel, bridge, ramp) |
| Coast | Already irregular: sea cuts the rect diagonally on the south and east side (0.76 km²), costa-del-este loses 26 % of its cells to sea | Keep; it is the only terrain-led edge today |
| Far frame | Beyond the active area: grey/low-detail skirt "by design" (README) but concretely a flat plane + fog | Needs real far terrain (ridges as silhouette) for the "feels bigger" goal; not data today |

## 5. Constraints any reshape must respect

1. **Determinism**: same seed + same spec gives the same world. Terrain, outline and generators stay pure functions of the
   spec (street graph, `Terrain`, seed placement are all pure today).
2. **Specs first** (CLAUDE.md): `world.yaml` and `specs/map/README.md` change before code; `parseWorldSpec`
   is strict, unknown or missing keys are problems. The validator `tools/render_map_preview.py` mirrors the TS rules
   and must be updated in the same change.
3. **Spawn and Act 1 landmarks stay playable**: `tito-home` inside the outline; the 6 landmarks within 2.5 km of each other
   keep the mission geometry (spawn to market 825 m). Landmark pads and triggers (radius 20 m on `corridor-market`) need flat ground.
4. **Fixed avenues are constraints**: `corridor-avenue`, `transisthmian-highway`, runways are hand-drawn routes the generator never moves
   (street test "avenues intact"). Runways need `runway_flat_tolerance` 0.05 m and the airport flatten zone.
5. **Real-data bands**: the realism test asserts La Carpio / Santa Ana bands on the generated network (9/10 seeds, spec seed must
   pass) with negative controls. Any change of the district area definition changes `area: 'cells'` vs `'land'` metrics and the band.
6. **Terrain targets**: hills and plain slope percentiles, coast within 0.5 m, runway flat; slopes calibrated to real data, not heights
   (map is compressed about 1:4).
7. **Performance**: street generation under 1.5 s cold and warm (now about 0.27 / 0.16 s), terrain bake 4 m grid, building count
   10 k; a larger outline or finer grid must stay in budget.
8. **No interior cuts in the data model**: `playable_boundary` is two lines monotone in y (`polylineXAtY`, slice.ts:74-77);
   an outline with north/south edges or concavities needs a polygon representation first.
9. **Walls are invisible collision only**: any new limit (river, ridge) must be both visible and blocking, and blocking must stay
   consistent with `isPlayableLand` (walk graph and block faces use it).
10. **One act at a time / original content**: detail only Act 1; macro frame (river network, ridges) can be defined for the whole
    map; real Panama places stay as `inspired_by`.
11. **Do not disturb in-flight work**: relief (`terrain.ts`, `relief:`), La Carpio seed (anchor (5000,2600), mirror, 40 deg) and
    frontage-lots are uncommitted; the seed anchor and hill/flatten rects are absolute coordinates and break if the outline
    is moved without moving them.
12. **District codes are the grid's**: `target_km2`, `grid`, the world map labels and Python checks all assume cells; if districts
    become polygons, the grid must be kept as the area budget or retired explicitly (director decision).

## Open questions for the next step (02-alternatives)

- Outline as polygon in `active_area`, or as a computed mask from a suitability field with the polygon as its derived hull?
- Do districts become polygons now (needed for river/ridge borders) or only the outer outline?
- Do rivers reuse `waterway` + `BARRIER_KINDS` (street exclusion already works) with a narrower profile?
