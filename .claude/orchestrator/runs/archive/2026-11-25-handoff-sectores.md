/orchestrator full transito: continue the sectors / airport / map-LOD run from 2026-11-25. Do NOT redo finished work: first VERIFY the state below against the repo (every claim is evidence, not fact), then continue.

## Read first
1. `transito/CLAUDE.md` (one act at a time; specs first; director owns story; no commit/push unless asked).
2. `transito/.claude/orchestrator/runs/2026-11-25-mapa-arquitectura-sectores.md` (the run file: cards, decisions, lessons).
3. `transito/docs/map-reshape/03-technical/12-sectors-and-streaming.md` (489 lines: the architecture; sections 6 and 8 hold the card plan and decisions).
4. Panama research: `docs/map-reshape/01-investigation/panama-essence-and-tourism.md`.

## What the director asked (2026-11-25)
Full architecture of the isthmus map; Panama City essence + tourist places; tunnels/bridges as portals that split the map into sectors and free memory while the next fills (PS2-style budgets, in a browser). Use all three tools: web research, the geospatial engine (`npm run geo`, skill `map-from-reality`) and Map Studio (`node tools/map-studio.ts`, dryRun only, never `save`/`force` without his word). NOT a 1:1 copy of reality: an adaptation (real places give numbers and character only; own names).

## Director decisions already taken
- 7 sectors accepted (limon, lago, corte, ribera, ciudad, corredor = Act 1, cordillera). Cordillera = jungle backdrop, plus ONE hiking trail near the airport.
- `arch-bridge` follows the GENERATED road/canal crossing (placement by rule, not coordinates).
- Seamless transitions; portal controls (fog ramp, speed floor) only if needed. NO closed portal stubs in Act 1: the map (world map + minimap) is blurred like GTA's, sharp near the player.
- The airport "levitates" on a hill: needs grading.
- My judgment calls (reversible, flag them): trail one-way terminal -> ridge viewpoint (spec + route only); map LOD only + light minimap-rim blur; embankments with limited slope, no walls, don't move the airport hint; loading veil <= 1 s only for teleport/debug-fly; retired-sector state = deterministic regeneration + small keyed state record (design only).

## State at the time of this prompt (verify with `git status --short`, nothing is committed)
- DONE and verified: audit of render/memory (nothing is ever freed except pedestrians; isthmus = one 10.6 MB blob); Panama research doc; 4 engine fragments (casco-viejo, panama-viejo-ruins, costa-del-este, portobelo-bahia; paitilla-towers and albrook-terminal timed out on Overpass, NOT measured; 3 imports stuck "pending" in the engine DB); design doc 12; sector table (`specs/map/sectors.yaml`, `src/world/sectors.ts`, `tests/sectors.test.ts`: 7/7 green, mutation checked).
- RUNNING when this prompt was written (check their output or `git status`, they may have finished): agent "Airport grading" (doc 12 card 1: new `procedural.airport.grade_*` keys, slope-limited embankments, guard `airport-pad-floats`, `tests/airport-grading.test.ts`) and agent "Map blur LOD" (card 4: pure `mapTierAt` in `src/sim/map-view.ts`, `tests/map-lod.test.ts`). If they did not finish, inspect their partial diff before spawning anything on the same files.
- NEXT cards, in series (they share `src/studio/guards.ts`, `params.ts`, `src/world/spec.ts`): card 2 rule-based `arch-bridge` placement (`tests/landmarks.test.ts`), card 3 airport hiking trail (`procedural.trails`, `src/world/proc/trails.ts` reusing `leastCostPath`, `tests/trails.test.ts`). Then card 0 (baseline measurement: heap, GPU, colliders, map canvas bytes; needs a browser, the MAIN session does it), cards 6-12 of the doc (teardown contract, per-sector slice, Act 1 as sector #1, worker + seamless swap, Studio guards for sectors/portals, far-tier LOD, portal prototype P2 which waits for an act that crosses it).
- Look in the browser (main session, after the agents finish): `npm run dev` -> plane view of the isthmus, airport at about (5019, 2858): does the pad still float? map screen (Tab) and minimap: sharp near the player, blurred far. Stop the dev server afterwards.

## Verified numbers to reuse (not the stale ones)
- Act 1 rect WITH the saved Studio edits (`specs/map/procedural-edits.json`, uncommitted, the bake uses it): x 3056-5465, y 824-3782 = 7.13 km2; 612 street edges; 1,160 buildings. The old 6.13 km2 / 545 / 1,358 came from world.yaml alone: any probe must load the spec with `parseWorldWithEdits` (src/studio/saved.ts).
- Car top speed 16 m/s (`CAR.maxForward`). Overview 760.7k tris / 32 draws / 60 FPS (2026-11-24, before the saved edits, so stale). Isthmus generation 6.0 s; Act 1 streets + city 0.26-0.42 s.

## UPDATE (later the same day)
- Card 1 (airport grading) DONE and verified: `procedural.airport.grade_slope_max: 0.35`, `grade_reach_max: 600` (0.33 makes the unedited map unbuildable), guard `airport-pad-floats`, `tests/airport-grading.test.ts` 4/4. Side effects (measured by the agent): Act 1 anchor (4179,1581) -> (4288,1263); `passenger-terminal` (4904,2667) -> (4753,2905); cut 15.1 -> 57.3 Mm3. Not yet confirmed in an oblique in-game view from the low ground west of the pad (the top-down render and the terminal-side capture look fine). Capture recipe: `npm run dev` in background, `node tools/capture.mjs --out x.png --url "http://localhost:5173/?play&spawn=passenger-terminal" --wait 20000 --gpu metal --keys "KeyV:150,KeyD:3500"` (V cycles the camera mode); stop vite after.
- Card 4 (map blur LOD) DONE: tests map-lod 7/7, own mutation red->green; not yet looked at in the browser (Tab map and minimap rim); minimap now builds a 33 MB M0 layer at start (watch the 'detail layer in N ms' console line).
- Card 2 (arch-bridge by rule) was RUNNING; then card 3 (trail). Tangent found by an agent: the Linea 2 router can put track in open sea when the interamericana re-routes slightly (seen with grade_slope_max 0.33): ticket candidate.

## UPDATE 2 (19:37)
- Cards 2, 3, 0, 7, 6 of doc 12 are DONE and verified (arch-bridge by rule; airport trail spec+route; baseline; per-sector slice `src/world/sector-slice.ts`; teardown contract `src/ecs/scope.ts` + `own()` in plugin ctx, world-view and world-physics disposal). Full sweep: 70/70 test files (461 tests), typecheck 0, build 0; validator rc=1 only for the old `procedural.districts` error.
- Act 1 rect now x 3588-5450, y 562-3610 (5.68 km2); in-game console baseline: 516 street edges, 1200 buildings, 126,780 near-ground tris, 1746 colliders; play view 686.6k tris / 23 draws / 60 FPS, JS heap 66-97 MB of a 4192 MB limit (GPU and Rapier WASM memory still unmeasured).
- NEXT: card 8 (Act 1 as sector #1: build + dispose, flat heap after 5 reloads), 9 (worker + seamless swap), 10 (Studio guards for sectors/portals), 11 (far-tier LOD for #11), 12 (portal prototype P2, deferred). Teardown gaps to close first: Rapier World.free, pedestrian pool, minimap/world-map canvases, window listeners (debug-mode wheel), engine/meshes.ts shared meshes.
- Close every run with a sweep over ALL tests (`for f in tests/*.test.ts`), one at a time: `tests/architecture.test.ts` forbids `document`/`window` words anywhere in src/world and src/sim.

## Known open items and proposed tickets (not created; ask before creating)
1. `python3 tools/render_map_preview.py` exits 1: `procedural.districts: unknown key` (Python mirror lacks the #13 districts key; preexisting at commit ec609f7). CLAUDE.md says the validator must be 0.
2. `game-probe.ts` / `scale-probe.ts` ignore the saved edits (stale numbers).
3. Engine imports of dense areas time out at 600 s and stay "pending"; do not retry Overpass in a loop.
4. Airport grading ticket (the active card 1 covers it).
Still open for the director: Q6 confirm, N2 confirm interpretation of "blurred like GTA", whether to commit the pile of uncommitted work (docs, fragments, sectors, procedural-edits.json).

## Rules for this machine and this run
- 16 GB laptop: at most 2 background agents, at most 1 heavy; Node tests capped (`node --max-old-space-size=1536 --test --test-timeout=120000 <one file>`); agents never start dev servers, browsers or Docker; Colima/engine are OFF now (start with `../geospatial-reconstruction-engine/scripts/dev-up.sh` + uvicorn only if a card needs it, and stop them after).
- Never implement in the orchestrator session: briefs to sonnet agents with acceptance criteria and check commands; the repo wins over any agent report; mutation-check every guard (print the diff proving the break applied; python string replace, not `sed -i` on macOS).
- Remotes use `github-personal`; `gh` calls carry `GH_TOKEN=$(gh auth token --user josuecm13)`.
- Respond to the director in English (artifacts follow the repo convention). End the run with the Lessons step (max 3 lines in the run file's `## Lessons`; candidate rules are promoted only when they repeat in 2 runs and the director approves).
