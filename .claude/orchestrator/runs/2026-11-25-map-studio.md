# 2026-11-25: Map Studio (#13) — config API, edit core, CLI, then UI

**Goal:** build #13 in the issue's order (CLI before UI). **Mode:** lean. **Issue:** #13
**Resume from:** done (director to review; extent policy + tickets pending)

## Verified state
- #13 prerequisites: #12 Pendiente 1 (tree committed; `git status` clean except a docs line) confirmed; 2.1 (params in `procedural:` of world.yaml, strict parser) confirmed; `params.ts` gone.
- `generateIsthmus(spec, {cell})` reads `spec.procedural` only → config API is `opts.config`.
- Only 3 callers parse world.yaml: world-data.ts (game), render-isthmus.ts, bake-isthmus.ts.

## Design decisions (mine, flag to director)
- Config = the `procedural:` YAML mapping (snake_case, stops named). Validation = the existing strict parser (one source); ranges/units table for `describe`.
- `save` cannot rewrite world.yaml without losing its comments → writes `specs/map/procedural-edits.json` (versioned overlay of path/value changes) applied on load by tools. World.yaml stays hand-readable.
- Extent change (World group) needs a rescale policy for the authored coast: deferred, see open questions.

## Cards
| # | Card | Check | Result | Fix rounds |
|---|---|---|---|---|
| 1 | `generateIsthmus` accepts `config`; default hash unchanged | fp.ts before/after | green | 0 |
| 2 | Pure edit core (paths, patch, dryRun, revision, validate, diff, metrics) | tests/studio-core.test.ts | green | 0 |
| 3 | CLI JSON stdin/stdout + round trip | tests/studio-cli.test.ts (5 tests) | green, mutation-checked (process.exit() back → truncation test red → restored → green) | 1 |
| 4 | Invariant guards, mutation-checked | tests/studio-guards.test.ts | green | 0 |
| 5 | District model + presets | tests/studio-districts.test.ts | green; `districts-airport-gap`, station causality, generator-throw refusal, save-cell and tolerance fixes each mutation-checked (red → restored → green) | 1 |
| 6 | Causality matrix (4 edits + conflict) | protocol run at 20 m, docs/map-reshape/map-studio-causality.md | green: 5 edits + 3 refusals measured after the tolerance fix; station move changes only transit+districts | 2 |
| 7 | Studio UI | typecheck/build + look | green: map-studio.html + worker; edited map, refusal, pinned anchor, compare, 20 m rollback, save endpoint driven in headless Chrome over CDP; tests/studio-memo (3 mutations red→green) and studio-bake-key (1 mutation red→green) | 1 (rollback at 20 m added after seed 12 passed at 40 m) |
| 8 | Docs, benchmarks | all green | green: 3 docs + README rows, tools/bench-studio.ts; tsc clean; 63 test files / 418 tests pass (one at a time); npm run build ok; npm run isthmus ok | 0 |

## Decisions and open questions
- OPEN (director): extent change / coast rescale policy. Not built; the World group shows the extent locked.
- Línea 2 one line or two (#12): editor keeps current.

## Lessons
- redone: guard thresholds (canal gap, river-at-airfield radius) and two mutation inputs were wrong first time; the guards were fine, my mutations didn't violate them
- cost: reading the 1800-line parser surface and the whole issue; each generate is ~6 s at 20 m, 1.5 s at 40 m
- rule: when a guard test's mutation doesn't fire, print the guard's actual output on the mutated input before touching the guard
- finding: coarse cells change the map (cell 20 vs 40: airport 5170,2620 vs 5330,2780; cell 60 gives a bay-crossing conflict for la-ciudad 2.0). Hashes are per cell; previews are approximations; use 20 m for the causality matrix.
- finding: causality (c) (station move shifts coarse density) cannot show yet: towns are grown before transit, so station moves only change stations. Needs the district model D(p) (card 5).
- finding: CLI truncated any response over 64 KiB when piped (`describe` is ~70 KB): `process.exit()` after `console.log`. Fixed with `process.exitCode` + stdout.write. Card 3 had been marked green with no test file; corrected 2026-11-25.
- finding: the issue's own example patch (lake target 5.8 km²) is refused at cell 40: it floods gamboa-road (guard routes-connected) (210 m from the authored stop at 20 m, 251 m at 40 m). Briefly looked like a 40 m-only refusal: false, see the next findings. The `describe` example now uses la-ciudad 1.9 (verified ok); docs (card 8) must not present 5.8 as valid.
- card 5 design (mine, flag to director): districts are an additive post-transit field `Isthmus.districts` (src/world/proc/districts.ts); with no items it is zero and `hashes.all` is unchanged (verified against the old code's `all` for the same request). The coast term MULTIPLIES the district sum instead of adding (the issue's sketch would urbanise every coastline). Station term uses metro stations only, max not sum. Starter districts are NOT added to world.yaml (placing them is the director's call); presets are added with `add-district`.
- fix: test 5 first depended on the transit boost (the airport terminal is a metro stop); widened the test district to sigma 1500 so the guard test stands alone. A mutation check caught it.
- fix: `procedural.districts.items[*]` docs cannot resolve while the list is empty; the core "docs exist" test exempts that prefix and studio-districts checks they resolve once an item exists.
- note: `describe` now lists `districtPresets`; ops `add-district` / `remove-district`; `move-anchor` accepts `district:<id>`.
- finding: `evaluate()` did not catch generator throws (lake 9 km² at 20 m → `routeRoads … unreachable`), so the CLI/UI would crash instead of refusing. Fixed; regression test in studio-districts (rethrow mutation → red).
- finding (guard bug, fixed): `routes-connected` used `6 × cell` as tolerance, so the UNEDITED authored map failed at 20 m (gamboa stop snapped 170 m, tolerance 120 m) and passed at 40 m (180 m vs 240 m). At 20 m every edit passed 'no new violation' against an already-red baseline, and nothing could be saved. Now flat `ROUTE_END_TOLERANCE_M = 200` (baseline 170–180, lake 5.8 → 210/251); verdicts equal at 20 and 40 m (test). I first reported 'lake 5.8 accepted at 20 m' from the matrix: that was this bug, not a map property.
- decision: `save` validates at the authored cell (20 m) unless `cell` is passed; `validatedAtCell` in the response (test, mutation-checked).
- note: `airport_buffer: 3000` still reports a built cell 36 m from the airfield (guard fired correctly); worth a look in card 8 whether the buffer is applied after seed snapping.

## Card 7/8 notes (2026-11-25, second session)
- Verified before building: tsc clean; studio-core 8, guards 10, cli 5, districts 10 green. Hypotheses in this file held.
- UI: `map-studio.html` + `src/studio/ui/{main,worker,messages}.ts`; the worker owns the State and only calls `handle`. Dev-only `/__studio/save` in vite.config.ts writes the edits file after the protocol validated it. Not a build entry (like peds-lab.html): dev server only. Layer toggles are vector overlays from the config (ridge zones, districts, seeds, stops, routes, hints, canal); the base render is not re-rendered per layer (render.ts has no layer options; changing it rebakes).
- Evaluate memo (3 entries per base, key = config hash @ cell) in protocol.ts: patch before/after and the preview share one generation. Edit 1.5 s → preview 0.17 s.
- Fix in scope: `inputFiles` (bake key) did not hash procedural-edits.json, so a Save would not have rebaked the game's map. Added + test.
- Open item 1 answered: the buffer is applied to suitability before growth; the cause is elsewhere. A town seed is built whatever its suitability when no suitable cell is within `seed_snap` (settlements.ts `snap`, `best = c`); El Corredor's `seed_along` seeds lie on the Interamericana toward the terminal. buffer 3000 → exactly 3 built cells (the seeds at ~(4770,1530), (4810,1950), (4910,2390)), nearest 36 m from the field. Not fixed.
- Open item 2: Línea 2 untouched (`linea-2-unchanged`). Item 3: no starter districts added (the UI says none are placed). 
- finding: generator buildability depends on the cell: unedited map is unbuildable at 44 m and 64 m (`routeRoads: gamboa-road leg 1 unreachable`), fine at 40, 48–60, 80; seed 12 passes at 40 m and fails at 20 m. UI validates every accepted edit at 20 m and rolls back with the reason.
- finding: lake.target_km2 5.2 and 5.5 are refused (routes-connected) too; 5.0 authored is the edge, 4.5 accepted.

## Proposed tickets (not created)
1. [map] Town seeds are built regardless of suitability, so `airport_buffer` does not hold for seed_along towns (settlements.ts `snap`). Acceptance: with `airport_buffer: 3000`, airportToTownM ≥ 3000 (or seeds inside unbuildable ground are moved/dropped).
2. [map] Generator fails on the unedited map at cells 44 and 64 m (`routeRoads: gamboa-road leg 1 unreachable`) and for relief.seed 12 at 20 m: routing should not depend on the grid this fragilely.
3. (resolved, not a ticket) the 2026-11-22 row of log.md had the Map Studio status text: a replace-all slip when the index row was written; restored to "en curso".

## Lessons
- redone: first memo test used cells 70/76/72 that the generator cannot build; probed the cells before choosing. `sed -i` without a backup suffix on macOS silently skipped three mutations (reported red for the wrong reason): a mutation helper must assert the file changed; a string replace over an index file must be anchored to one line
- cost: driving the UI (no Chrome extension available: headless Chrome over CDP script in /tmp); each 20 m generation is ~6 s
- rule: a mutation check counts only after printing `git diff`/diff of the mutated file proves the break was applied
