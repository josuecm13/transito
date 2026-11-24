# 2026-11-24: Mapa — verificación, decisiones y plan de distritos

**Resume from:** F done (F1–F6 green, uncommitted; commit only when the director asks, never `package.json`/`src/main.ts`). Next: #11 items (F3 notes), T1 (tito-home on the highway, proposed issue), the open spec decision from F5 (remove the retired world.yaml sections?). walk-graph fixed (see F3 walk-graph below). F1+F2+F3 uncommitted; no commit until the director asks; `package.json`/`src/main.ts` never committed. Tito-home's note stays as it is (director).
**Goal:** resume from `2026-11-24-next-session-handoff.md`: verify the state, settle the open decisions, propose
the plan, and wait for the director's go. **Mode:** lean. **Issue:** #12 (2.2 → 2.5), #13 step 7.
**Director instruction this session:** "don't ask me". The orchestrator took the decisions below with the most
conservative option that the primary sources support. Nothing was implemented, committed or pushed.

## Verified state (2026-11-24)
- `main` = `origin/main` = `c376cc4` (after `git fetch`). Remote `git@github-personal:josuecm13/transito.git`.
- Uncommitted: the 11 modified files from the handoff (+247/−44); untracked: 3 run files + `.claude/orchestrator/tools/`.
- Fingerprint `fp.ts` == `tools/fp-2026-11-24-composition.txt` (all 11 parts identical). Report: airport (5170, 2620)
  10°, spread 38.5 m; towns 1.75 / 0.59 / 0.45 / 0.54 / 0.01 km².
- `npm run typecheck` 0 · `python3 tools/render_map_preview.py` 0, `preview.svg` unchanged ·
  `tests/proc-isthmus.test.ts` 13/13 · `tests/spec.test.ts` 19/19. The full suite was not re-run: no code changed since it ran.
- #13: 3 art-direction comments (2026-11-23 20:58) plus a 4th, **"Implementation order"** (2026-11-24 00:52), which
  the handoff doesn't mention. Step 7 is already "coarse district model `D(p)` + presets (Casco, Cinta Costera,
  Paitilla/Pacífica, hillside, El Corredor, Tocumen buffer, ports) as fields and metadata for #7. No streets or parcels."

## Decision 1: building scale, diagnosed without a screenshot from the director
Probe `.claude/orchestrator/tools/scale-probe.ts` (reads `buildWorldData`, the game's current pipeline) plus 3
captures of the game at the spawn (`tools/capture.mjs`, `/tmp/transito-scale/0-topdown.png`, `1-near.png`, `2-far.png`):
- Near Tito, sizes are realistic. Within 150 m: 217 frontage-lot houses, 9.3 × 11.5 m, **3 m** tall (p90 6 m).
  The generic rule (8–16 m, 4–10 m) **never fires**: `tito-corridor` uses only frontage-lots.
- Slope adds little: the base sits at the lowest ground under the footprint (`terrain.footprintBase`), so the downhill
  wall shows a median of +0.7 m (p90 +2.1 m). Downhill walls: median 4.1 m, max 9.3 m.
- **What dominates the 3D views is the horizon:** Costa del Este towers (336 buildings, 18 × 18 m, **41 m** median,
  up to 56 m) and the airport terminals (34 × 28 × 11 m), 0.6 to 1.7 km away. Distances are compressed about 1:4
  horizontally (README, "Compression") but heights stay 1:1, so a tower at 1 km of game distance looks as big as it
  would at about 250 m real. Flat boxes with no storeys, windows or doors read as monoliths.
- No house within 28 m of the spawn: `tito-home` sits on a wide intersection plus `landmark_clearance` 18 m.
  Nothing human-scale is beside Tito to compare against.
- **Conclusion:** the cause is how the views are composed, not the lot sizes. Uncompressed heights against compressed
  distances, boxes with no scale cues, and an empty spawn. Confidence is moderate: this is what the spawn shows in all
  three cameras; the director may have been looking at another spot.

## Decisions taken (director said "don't ask")
| # | Decision | Basis |
|---|---|---|
| 1 | Cause diagnosed (above). Fix inside the scale rules card (B) and the LOD (E), not by touching lot sizes | probe + captures |
| 2 | **Silhouettes** for Casco/skyline until their act; detail only for El Corredor | CLAUDE.md rule 3; #13 comment 2 ("detailed street synthesis remains #7's… expose presets… at LOD") |
| 3 | **Expand #13 step 7** (no new issue) and bring it forward: it only needs the schema from 2.1, which is done | #13 already defines `D(p)` + presets; memory "prefers bigger issues" |
| 4 | Commit = first card, **runs on the director's go** (CLAUDE.md: commit only when asked) | project rule |
| 5 | **Don't move the coast** | #13 comment 1: "Preserve the accepted coastline silhouette"; 6 of 28 landmarks would end up in the sea |
| 6 | Hamlets + farmland: **after** the districts, as coarse cover; B2/B3/B4 keep their order | #13 comment 3 (green/farmland between centres); not Act 1 |
| 7 | **Keep** `corridor-east` | #13 asks to keep the *decisions* about Línea 2 (one line or two), not its geometry; same branches and endpoints |
| 8 | Still open: Línea 2 one or two; "line 8"; `target_km2` net; #11 controls; one railway or two. The current interpretation stays | only the director can settle these |

## Proposed plan (waiting for the director's go)
| Card | What | Agent·model | Check |
|---|---|---|---|
| A | Commit the last session's work (generator rules + `procedural:` values + tests), without `package.json`/`main.ts` | orchestrator (git only) | clean index export: typecheck, the 2 tests, validator, fp == baseline |
| B | Human-scale rules: `scale:` in `world.yaml` (storey 3 m, door 2.1 m, lane 3–3.75 m, sidewalk ≥ 1.5 m, Tito 1.8 m) + strict parser + Python mirror + test that checks generated streets and buildings | implementer·sonnet | test mutated (storey 6 m → red) |
| C | #12 2.2: Act 1 anchored to the Línea 2 east midpoint **derived** from `generateIsthmus` (pure function, never hard-coded); `active_area` = the El Corredor strip | implementer·sonnet | fp unchanged; test that the anchor lies on dry land inside El Corredor; mutation |
| D | #12 2.3/2.4: landmarks snapped to generated features; airport in `world.yaml` | implementer·sonnet | validator; landmarks on dry land |
| E | #13 step 7 brought forward: `procedural.districts:` with terrain rules (coastal flat peninsula → historic core; flat waterfront → towers; steep slope → hillside; flat interior → formal blocks; highway ribbon → El Corredor; canal mouth/locks → port; pinned to a stop) → `D(p)`; full El Corredor preset (#7 + La Carpio fingerprint); the rest as silhouettes with **compressed heights** (fixes the horizon from decision 1) | implementer·sonnet, 2–3 cards | render `.cache/isthmus.png` and look; #13 comment 2's 5 crops; mutation of each rule |
| F | #12 2.5: the game loads `generateIsthmus`; layers 6–9 only in the strip; LOD outside | implementer·sonnet | captures from the spawn + debug overview before saying "ready" |
| G | Hamlets/farmland → B2 → B4 → B3 → the rest of #13 | later | — |

Estimated cost: A–D ≈ 4 sonnet cards; E ≈ 3; F ≈ 2–3. One heavy process at a time.

## Cards
| # | Card | Check | Result | Fix rounds |
|---|---|---|---|---|
| A | Commit the last session's work (8 files; without `package.json`, `main.ts`, orchestrator state) | clean index export `/tmp/transito-a`: tsc, validator, fp == baseline, 2 tests, `preview.svg` cmp | green: tsc 0, validator 0, fp identical, 13/13 + 19/19, svg byte-identical → **`f6f7b2c`** (not pushed) | 0 |
| B | Human-scale rules `scale:` + parser + Python mirror + README; building heights in whole storeys; test | `node --max-old-space-size=1536 --test --test-timeout=120000 tests/scale.test.ts` + touched tests one by one + tsc + validator + fp == baseline; mutations | scale.test 6/6, tsc 0, validator 0 (`preview.svg` unchanged), fp identical. Mutations → red, restored → green: M1 parcel rounding, M2 Tito 1.9 m, M3 frontage +0.5 m, M4 generated sidewalks ÷2, M5–M7 parser (hierarchy lanes, storey range, door); Python P1–P5 (lane, door, storey range, `level_height`, sidewalk) exit 1 → 0. Full suite 55/55 files one by one (fail=0 in all), determinism 55/55, build 0. → **`63698a0`**, pushed with A (`origin/main` = `63698a0`) | 1 (`graph.edges` is a getter, not a method) |
| C | #12 2.2: `procedural.act1` (line, branch by end stop, `anchor_at`, town, barrio radius, strip half-width); `src/world/proc/act1.ts`; `Isthmus.act1` + report line; parser + Python mirror + README | `tests/proc-act1.test.ts`; fp parts identical; mutations | green (full suite 56/56 files one by one, determinism 56/56, tsc 0, validator 0, build 0): anchor **(4285, 1273)** = the handoff's midpoint, now derived; barrio 100% el-corredor; strip 2.32 km. fp: 11 parts identical, +1 report line. Mutations → red: C1 fraction ignored, C2 wrong branch, C3 share counts any town, C4 lake ignored, C5 parser branch_to; Python P1–P3 exit 1 → 0 | 0 |
| D | #12 2.3 (Act 1 + airport only): `procedural.landmarks` rules (anchor / along / steepest_within / airport); `src/world/proc/landmarks.ts`; `Isthmus.landmarks`; Act 1 overlay in the render | same test file (11 tests); render `.cache/isthmus.png` and look; mutations | green: tito-home (4290, 1270), corridor-market (4430, 1350) 165 m down the strip, miguelito-hills (4310, 1630), passenger-terminal = generated terminal, cargo on the apron. Mutations → red: D1 least steep, D2 no snap, D3 along ignored, D4 apron = terminal, D5 parser ids; Python P1–P3. Render looked at (crop): barrio on El Corredor, strip to the airport; strip edges fold slightly on the inside of the bend near the anchor (debug overlay only) | 1 (strip edge normals: windowed over ±12 points) |

### C/D decisions
- `active_area` does **not** move in C: the game still runs the authored pipeline, and the validator ties each authored landmark to its grid cell. It moves in F (2.5).
- D is additive: the authored `landmarks:` x/y keep driving the current game; `procedural.landmarks` places the procedural ones. Scope: Act 1 + airport (CLAUDE.md rule 3); canal and town landmarks wait for B2–B4.
- **Story note for the director:** `tito-home`'s note says "under the flight path". At the barrio centre (decision of 2026-11-22) it is ~630 m off the extended runway axis and ~1.5 km south of the airport centre (~900 m past the runway end): near the approach, not directly under it (computed from the report: centre (5170, 2620), heading 10°, house (4290, 1270)). Keep the note, or move the house towards the airport?

### F. #12 2.5: the game loads `generateIsthmus` (in progress)
Director 2026-11-24: go with F; leave tito-home's "under the flight path" note as it is.
Integration surface (verified by reading): `Terrain` takes `layer2` (fine + far HeightGrid) and `layer3` (carve + water)
as inputs (seam at `terrain.ts:173`); `layer1` cover is consumed by world-view, minimap, world-map, debug-mode
(`LandCoverKey`); the authored coastline `spec.land` feeds Terrain's shore distance and world-view's land polygons;
`sliceWorld` takes `active_area` rect + authored landmark x/y; streets use the authored district grid.
Consumer inventory (haiku Explore helper, spot-checked by grep): Terrain outside its file = heightAt, normalAt, footprintBase,
heightfield, grid, farGrid (baseGrid only inside layers/); water = rivers (points, width, surface), water (kind, level, ring,
holes), locks (chambers.apron, apronTop, id); cover = Layer1Output classes/cellFar/cols/rows/cover/density + coverAt/densityAt;
spec.land read by minimap, map-base, world-map-canvas, world-view, slice, streets; districts/grid by streets region + measure.
| F1 | pure adapter `src/world/proc/game-world.ts`: `ProcTerrain` (6 members), `waterFromIsthmus` (lake polygons from the mask, 1 cell wider; rivers with monotonic surface), `coverFromIsthmus` (game classes; towns = urban_prior) | `tests/proc-game-world.test.ts` 6/6; mutations G1 fine grid shifted, G2 holes dropped, G3 towns not urban, G4 river surface, G5 heightfield rows, G6 far grid ignored → red, restored → green | green, uncommitted | 0 |
Gaps of F1 on purpose: canal water and locks (outside the strip), street grading (streets drape).
| F2 | `procedural.game` (district_cell 200, rect_margin 300, source → district map) + parser + Python mirror; `src/world/proc/game-spec.ts`: game WorldSpec with rect = strip ∪ barrio, derived 200 m district grid, generated roads/runways/canal as routes, procedural landmark positions | `tests/proc-game-spec.test.ts` 5/5; mutations H1 towns ignored, H2 authored landmark x/y, H3 authored routes, H4 rect = barrio only, H5 parser; Python P1–P3 → red / exit 1, restored → green | green, uncommitted. Probe (`tools/game-probe.ts`): rect x 3584–5775, y 573–3370; 13 T cells (0.52 km² vs 0.54 built); 545 street edges; 1,366 houses, all El Corredor; dropped (authored, no rule, inside the rect): firm-tower, valeria-penthouse, gated-community | 0 |
Measured: `generateIsthmus` ~6 s in Node → in the browser it is startup time. Candidate card F6: bake at build time (deterministic) or Web Worker + loading screen.
| F3 | `buildWorldData(rawYaml, isthmus?)` runs on the procedural map: game spec (F2), `ProcTerrain`, lake/river water, cover; `WorldData` gains `cover` + `isthmus`; world-view takes the cover from WorldData; `paintWater` takes `GameWater`; authored-layer tests (terrain, layers-water) build the old world through `tests/authored-world.ts` (the removed code, verbatim) until F5 | full suite one by one: 57/58 green, tsc 0, validator 0, build 0; world-data budget kept (isthmus passed in: 335–486 ms vs 1500); **red: walk-graph.test 3/18** → after the walk-graph fix (below): **58/58 files green** one by one, tsc 0, validator 0 (`preview.svg` unchanged), build 0 | **done** (uncommitted): checks green; captures looked at (below) | 1 (walk-graph) |
**walk-graph red, diagnosed (not fixed):** test 10 = size thresholds of the authored rect (nodes > 1000 / crossings > 500; now 653 nodes) → adjust to the strip. Tests 12 + 13 = a real, pre-existing gap in `src/world/walk-graph.ts` that the new map is the first to hit: street node 11 (4256, 1259), next to Tito's house, is an **acute T** (~48°) of a local El Corredor street onto the Interamericana (highway, 24 m, no sidewalk) where the highway bends (NE arm 21.7 m). The corner between the local arm and the highway's NE arm lands inside the highway carriageway and is dropped as a whole (`walk-graph.ts` ~533), so only one corner survives (walk node 0), no crossing is built over the local's mouth, and its two sidewalks become separate walk components. Fix in walk-graph (corner fallback on the sidewalk arm when the wedge against a bare carriageway is acute), not in the test. Probe: `/tmp/transito-orch/wg.ts`.
**walk-graph fixed (2026-11-24, session 2).** The inherited diagnosis was half right: the Interamericana does **not** bend at node 11 (arms −152.7° / 27.0°, straight). The miter of the acute corner (local 529 vs highway 295) lands 20.9 m out on the local, inside the carriageway of **local 313** (3.2 m from its axis, half 3.5): locals 529 (from 11) and 313 (from 301) meet at 326 and close a ~1 m² island against the highway. Fix in `src/world/walk-graph.ts`: (1) acute wedge (< 90°) sidewalk-vs-bare whose miter lies on a carriageway → the corner moves along the sidewalk arm's offset line to the nearest point off every carriageway (`clearPointOnLine`; here s ≈ 20.4 m); (2) a cut node whose crossing doesn't survive (a kerb clip) takes the origin of its walkway's end, not of the crossed street's end (this hid behind the first bug: node 301's corners formed 2 groups). Tests: new synthetic `acute T onto a highway…` (geometry of 11/301/326); test 10 thresholds → strip (nodes > 500, crossings > 200; 653/246 now); test 14 `checked > 70` (86 now); random walk starts on the largest component (edge 0 now lies in a 28-node pocket cut off by the highway). Result 19/19. Mutations: M1 no acute fallback → red (synthetic, connected, intersection 11 no crossing); M2 no kerb origin → red (synthetic, intersection groups); restored (`cmp` identical) → 19/19.
**F3 captures (2026-11-24, `/tmp/transito-f3/`, dev server stopped after):** 1-spawn: world loads (generation 5.1 s, 545 street edges, 1,366 buildings, walk graph 653/879), 60 FPS WebGPU, minimap shows the barrio. **Tito spawns on the Interamericana carriageway** (tito-home (4290, 1270) sits on the yellow centre line) → tangent T1 below. 3-debug-overview (`?debug`, O): whole procedural isthmus, lake, rivers, runways, barrio. 4-free-mid / 5-plane-barrio (F2 + Space/S + wheel): free flight at 1–1.6 km reads well; barrio streets and houses visible. 6-tab-map: procedural cover already shows; the active area is an opaque grey box; "AEROPUERTO" label sits on the sea, away from the generated runways (inside the box).
**#11 notes (plane view / free mode at distance), to schedule after F:** (a) `?debug` starts the camera at (0, 0), 0 m, in the sea looking at the horizon → start at the overview pose or above Tito; (b) the minimap follows Tito, not the debug camera; (c) from above, the detailed rect is a flat beige box with a pale margin band (no cover) → F4; (d) speed by wheel works (100 → 1,455 m/s); no airplane controls (pitch/bank) — free-fly answers "either is fine"; (e) 648k tris at the overview, 60 FPS on Metal; no LOD yet (CPU SwiftShader not measured).
**Tangent T1 (proposed issue, not fixed in F):** the procedural `tito-home` anchor lands on the Interamericana carriageway; Tito spawns on the highway. Belongs to `procedural.landmarks` (card D rules: snap the anchor off carriageways). Story note stays as it is (director).
| F4 | Tab map / minimap / near + far ground on the procedural cover | touched tests one by one, tsc, captures `/tmp/transito-f4/`; full suite | **done** (uncommitted): full suite 58/58 files, tsc 0, validator 0 (`preview.svg` unchanged), build 0 | 1 (labels hidden by Tito's marker) |
**F4 (2026-11-24).** Cause of the "beige box" found by probe (`/tmp/transito-orch/blocks.ts`), not the cover (the rect is 77% forest): faces of the street graph closed by the active-area frame / highway / runways were painted as city blocks (largest: 582 ha in `jungle-ridge`, no buildings). Changes: `isCityBlock(spec, block)` in `streets/city.ts` (block of a district with a `blockout.districts` entry); world-view and `minimap-layer` (minimap + Tab detail) paint block ground only for city blocks; `GroundLayer.colorAt` (per-vertex colour) and the near land layer coloured by cover like the far ground (one `coverColor`); `gameSpecFromIsthmus` drops an authored `label_at` that falls outside its own district on the derived grid (airport (5500, 450) was on the sea); the Tab map tries the district name nudged ±20/±40 px when its point is taken (El Corredor sat under Tito's marker). Tests: `world-data` "isCityBlock…" (largest face not city; every block with buildings is city; city share 0.154 of the rect, 1.14 if every face counted); `proc-game-spec` "district labels…". Mutations: isCityBlock → true → red; label rule off → red; restored (`cmp`) → green. Captures looked at: plane view shows forest/clearings around the barrio, rect edges gone; Tab map shows cover, the generated runways and apron, AEROPUERTO on them, EL CORREDOR by the barrio; overview without the beige rect; tris 648k → 394k. Not labelled on purpose: CANAL CENTRAL and COSTA DEL ESTE (0 cells on the derived grid). Still visible: T1 (spawn on the highway).
| F5 | Retire the authored layers 1–5, the authored `Terrain`, their tests and `tests/authored-world.ts` | tsc; grep for references; touched tests one by one; full suite; validator (`preview.svg` unchanged); build | **done** (uncommitted): full suite 54/54 files, tsc 0, validator 0 (`preview.svg` unchanged), build 0 | 0 |
**F5 (2026-11-24).** Kept what the game still uses, moved verbatim: `LandCover` + `coverAt`/`densityAt` → `src/world/cover.ts` (was `Layer1Output`; `layer/generated/seed` fields dropped); `RiverCourse`/`WaterPolygon`/`LockChamber`/`LockOut` → `src/world/water.ts`; `HeightGrid` → `src/world/height-grid.ts`. Removed (plain `rm`, index untouched): `src/world/layers/` (6 files), `src/world/terrain.ts`, `tests/layers-contract|layers-land-cover|layers-water|terrain.test.ts` (incl. the 4 skipped), `tests/authored-world.ts`. Spec untouched on purpose: world.yaml still has `land_cover`, `rivers`, `water_bodies`, `airports`, `main_roads`, parsed and validated, drawn in `preview.svg`; verified by grep that no game code reads them (of `relief`, only `relief.grid`). README "Layers" carries a retirement note. Removing those sections is a spec decision for the director (it changes `preview.svg`). Touched tests: proc-game-world 6/6, map-layers 6/6; tsc 0.
| F6 | Bake the isthmus at build time (no 6 s generation at startup) | codec tests + mutations; build; dev captures with timings; full suite | **done** (uncommitted): full suite 55/55 files, determinism 55/55, tsc 0, validator 0 (`preview.svg` unchanged), build 0 | 1 (comment `**/*.ts` closed a JSDoc block) |
**F6 (2026-11-24).** Chose build-time bake over a Web Worker: it removes the 6 s instead of moving it off the main thread. `src/world/proc/isthmus-codec.ts` (pure; "TIS1" + JSON header + 8-byte-aligned typed arrays; tags for −0, NaN, ±Infinity, undefined); `tools/bake-isthmus.ts <out>` (deterministic: two bakes byte-identical; 9.5 MB, 4.0 MB gzip); `tools/vite-isthmus.ts` plugin + new `vite.config.ts`: `virtual:isthmus` → `isthmusUrl`; cache `.cache/isthmus-<sha256 of world.yaml + src/world/**.ts>.bin` (gitignored), baked in a child process when missing, emitted as `assets/isthmus-<hash>.bin` on build, served from `.cache` in dev (inputs watched; older bakes pruned); `src/plugins/world-data.ts` fetches + decodes, then `buildWorldData(raw, isthmus)`. Measured in the browser (dev, Metal): **isthmus loaded in 30 ms, world generated in 323 ms** (was 5,133 ms), same counts (545 edges, 1,366 buildings, walk graph 653/879); spawn and overview captures identical to F4. Build: first 6.5 s (bakes), second 0.3 s (cache). Tests `tests/proc-isthmus-codec.test.ts` 5/5: round trip deep-equal; `buildWorldData` on decoded == on generated (`assertSameData`); tagged values; garbage rejected; the hash inputs cover every module `isthmus.ts`/`spec.ts` import. Mutations → red: no −0 tag; Float64 decoded as Float32; no undefined tag; an import from `src/sim` in `isthmus.ts`; restored (`cmp` / `git diff` clean) → green. Not exercised: the dev-server rebake after editing an input (watch path), reasoned only.
**Director request (2026-11-24, during F3):** debug mode with a plane view or free mode to see the map from a distance. Exists in part: C7 free-fly (`?debug` / F2, O = overview); #11 = start in debug + airplane controls + LOD. "Plane view or free mode" answers #11's open question: either is fine. Check it on the procedural world in F3's captures; schedule after F.
Director asked (2026-11-24) about browser limits; answered in chat: main thread (6 s generation) is the bottleneck; memory/GPU/physics fine at Act 1 detail.
Draft cards: F1 pure adapter `Isthmus → game layers` (heights fine/far, water, cover) with tests · F2 `active_area`
derived from act1 (rect = strip ∪ barrio bbox + margin; spawn and Act 1 landmarks from `Isthmus.landmarks`) ·
F3 `buildWorldData` switches to the adapter; streets/buildings only in the strip, district from the town map ·
F4 Tab map / minimap / far ground from the procedural cover · F5 retire authored layers 1–5 and the 4 skipped
terrain tests; captures from the spawn + debug overview before saying "ready".

### B. Human-scale rules
Files: `specs/map/world.yaml`, `specs/map/README.md`, `src/world/spec.ts`, `tools/render_map_preview.py`,
`src/world/scale.ts` (new, pure), `src/world/streets/buildings.ts`, `src/world/streets/frontage-lots.ts`,
`tests/scale.test.ts` (new), `tests/streets-frontage-lots.test.ts`.
Rules: `human` 1.8 (= `TITO_BODY`); `storey` 3 (replaces `frontage_lots.level_height`: one source); `door` [0.9, 2.1]
(storey ≥ door height); `lane` [3, 3.75] (each `traffic` kind and each hierarchy class holds a whole number of lanes);
`sidewalk_min` 1.5 (sidewalk 0 or ≥ min). Parcel buildings: height drawn as before, rounded to whole storeys inside
the district's range (same RNG draws, so positions don't move); a range holding no whole storey is a spec error.
Out of scope: compressed heights outside the active area (card E), `generateIsthmus` (fp must stay identical).

## Lessons
- redone: the new test called `graph.edges()`; it is a getter. Typecheck the test file before the first run.
- cost: the full suite one file at a time (~5 min) ran in the background; only the failures and a count came back.
- redone: the first C/D suite run was stopped: D's edits landed while it ran. Don't edit files a background suite is reading; queue the edit or the run.
- rule: when a spec value moves to a new shared section, keep the old field in the type but fill it from the new source in the parser, and make the old yaml key an unknown-key error (one source, no generator signature changes).
- The handoff left out #13's 4th comment ("Implementation order"), which changes decision 3. Read the issue's comments, not just the summary.
- Building scale: measure with a probe over `buildWorldData` before guessing; a 3-screenshot capture was enough to see the horizon.
- redone (F3): the inherited walk-graph diagnosis said the highway bends at node 11; a 3-line probe showed it is straight and the miter lands on a second local (313). The fix still went where the director said (walk-graph, corner on the sidewalk arm), and fixing it exposed a second bug the first hid (kerb-cut origin).
- cost (F4): the "beige box" looked like a cover bug; one probe over `buildWorldData` (`/tmp/transito-orch/blocks.ts`) showed 582 ha of wild faces painted as blocks. Probing the data took 1 run; guessing in render code would have taken several. No `failures.log` lines this session: the orchestrator arrived as pasted text, so its PostToolUseFailure hook never loaded.
- rule: after a pipeline switch (authored → procedural), probe every value still taken from the authored spec (labels, block faces, landmarks) on the views the director opens before calling a card done.

## Follow-up (director said "todo")
- F committed as be4ad0f (package.json and src/main.ts left out).
- T1 filed as josuecm13/transito#14 (tito-home anchor on the Interamericana carriageway).
- Spec cleanup: land_cover, rivers, water_bodies, airports, main_roads removed from world.yaml, spec.ts (parse + types), render_map_preview.py (checks + drawing), tests/spec.test.ts, README. Canal and relief stay. preview.svg lost 59 lines. tsc 0, validator 0 (canal guards fire: lake_level and chamber mutations), build 0, suite 55/55 files.
- Open from the director's screenshot at Tito (4330, 1663): ground looks flat brown and, at a cliff edge on the right, the sea shows underneath. Not investigated yet (capture was declined). Suspect: seam between the baked land layer and the far ground.
