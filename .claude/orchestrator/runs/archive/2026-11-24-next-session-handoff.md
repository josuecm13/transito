TRÁNSITO map work — continue from the 2026-11-23/24 session. Do NOT implement anything yet: first verify the state, then collect my answers to the open decisions below, then propose the plan for the chosen work and wait for my go.

## Where things stand (verify each claim against the repo before relying on it)

Repo: personal-projects/transito, `main` = `origin/main` = `c376cc4`. **Nothing from the last session is committed.** Uncommitted: 11 modified files (+247/−44) and 2 untracked run files; `package.json` (scripts reordered) and `src/main.ts` (plugin list one per line, same 15 plugins) are older cosmetic changes that came before that session — leave them alone unless I say otherwise.

Last session (run file `.claude/orchestrator/runs/2026-11-23-mapa-composicion.md`) did A1 + A2 + B1 from the options in `2026-11-23-mapa-opciones.md`:
- **New town rules in the generator** (`src/world/proc/settlements.ts`, `isthmus.ts`; spec, strict parser `spec.ts`, Python mirror `tools/render_map_preview.py`, `specs/map/README.md`):
  - `towns.separation`: minimum unbuilt distance between different towns;
  - `towns.airport_buffer`: no building within that distance of the airfield;
  - per-town `patches: { wavelength, threshold }`: unbuilt gaps that growth crosses but doesn't count;
  - `seed_along.reach`: a corridor town builds only within that distance of its road.

  With all of them off, the fingerprint was identical to the previous one.
- **Values now in `procedural:`:**
  - airport hint [5350, 2800], heading_range [10, 30], distance_weight 0.05;
  - a `corridor-east` (4700, 1500) via stop on the Interamericana **and on Línea 2's east branch**;
  - towns 1.8 / 0.6 / 0.45 / 0.6 km²; separation 200; airport_buffer 350; El Corredor reach 400 with patches.
- **Result** (`npm run isthmus` → `.cache/isthmus.png`): airport (5170, 2620), heading 10°, spread 38.5 m; towns 1.75 / 0.59 / 0.45 / 0.54 / 0.01 km²; **Línea 2 east midpoint moved (3929, 1070) → (4285, 1273)**. Derive it from the generator; never hard-code it.
- **Checks were green:** 54/54 test files run one at a time, `npm run test:determinism` 54/54, typecheck 0, validator 0, build 0. Guards were mutation-checked: separation, patches, airport buffer, reach (both enforcement sites), plus the parser rules.
- **Fingerprint baseline of this state:** `.claude/orchestrator/tools/fp-2026-11-24-composition.txt`. Script: `.claude/orchestrator/tools/fp.ts`, used as `node --max-old-space-size=1536 .claude/orchestrator/tools/fp.ts "$PWD"`. In-memory spec trials, repo untouched: `.claude/orchestrator/tools/try.ts <repo> <out.png> '<JSON [[from,to],...]>'`. Write the JSON with a quoted heredoc, because zsh `echo` mangles `\n`.
- **Rejected:** the vision's airport spot (~5440, 3270) sits on the `cordillera-south` spur: 69 m of earthworks, and El Corredor collapses to 0.00 km². Tuning `relief.hummocks` (170 or 200) breaks generation: `routeRoads: gamboa-road leg 1 unreachable`.

## Findings that change the picture
- **Ocean:** measured with the generator data and Pillow. Ours is 18% ocean, 10.4% lake, 71% dry land; the vision is about 28% ocean. The vision's **south coast is 500–800 m further north across the whole width**; the north coast matches within about 100 m. Shifting `geometry.land` 600 m north would put 6 of 28 authored landmarks in the sea or on the new shore: arch-bridge, old-quarter, coastal-avenue, firm-tower, valeria-penthouse, gated-community. The game's authored layers use the same coastline.
- **Building scale:** I said in-game buildings looked far bigger than the 1.8 m player and the pedestrians. On paper the sizes are realistic: Tito 1.80 m (`src/sim/body.ts`); El Corredor frontage lots 9.0 × 12.2 m, 3 m per storey, 1–2 storeys (La Carpio fingerprint); generic `blockout.districts.tito-corridor` 8–16 m footprint, 4–10 m tall. The cause is **not diagnosed**. Candidates: plain boxes with no scale cues, camera distance or field of view, the generic rule firing instead of frontage lots, and the ~1:4 horizontal compression of the corridor. Look at it in the game before changing anything.
- **#13 has three director comments (2026-11-23 20:58)** that set the art direction: the procedural render is the visual baseline, not the glossy concepts; the layout reads small capital → patchy El Corredor → green → isolated airport; districts as morphology; the railway is a separate service. Read them.

## What I asked for at the end (direction)
I want different generator rules and **defined districts that follow the relief and are themselves procedural**, so the urban generator can produce a Casco Viejo layout, a city skyline, and so on. The proposal on the table, which I haven't approved yet:
1. **District map for the whole isthmus from terrain rules**, defined in `procedural.districts:`. Rules: historic core on the flat coastal peninsula, towers on the flat waterfront, incremental hillside on steep slopes, formal blocks on the flat interior, El Corredor as the highway ribbon, port by the canal mouth and locks. A district can be pinned to a named stop.
2. **Per-district presets:** street pattern (reusing #7's tensor-field and organic-growth generator in `src/world/streets/`), lot sizes and building rules, with real fingerprints through `map-from-reality`.
3. **Level of detail:** full streets and buildings only in the active area; elsewhere district colour plus a silhouette and skyline.

Plus one fixed set of human-scale rules (storey, door, lane, sidewalk) with a test.

## Open decisions (ask; don't assume)
1. A screenshot of where buildings look too big (to fix the real cause).
2. Detailed Casco and skyline now (bending project rule 3, one act at a time), or silhouettes until their act?
3. A new issue for the districts work, or expand #13 step 7?
4. Commit the last session's work first? (I haven't answered yet.)
5. Shift the south coast about 600 m north? Now is the cheapest time, before #12 2.2.
6. City–Colón stretch: hamlets along the Transístmica and at rail stops, plus farmland cover (recommended); Gamboa and the bridge (B3); lake islands (B2); small infrastructure.
7. Línea 2's new `corridor-east` via stop: keep? It's the same two branches and endpoints, but #13 asks to keep Línea 2 unchanged until I decide.
8. Still open from before: Línea 2 one line or two; "line 8" = Línea 2?; `target_km2` as net built area?; #11 free-fly or airplane controls; one railway or two (`roads.routes.railroad` and `transit.ferrocarril`).

Recommended order from last session, subject to the answers: commit → (coast shift?) → #12 2.2 (Act 1 placed at the Línea 2 east midpoint, computed from the generator) → 2.3/2.4 → district map + El Corredor preset → #12 2.5 (the game loads `generateIsthmus`) → other presets as silhouettes → B2/B4/B3 → #13.

## Images
- Vision: `~/Downloads/Mapa del Istmo_ Canal y Cordillera.png`
- Transit sketch: `~/Downloads/Mapa de Metro y Ferrocarril Interoceánico.png`
- Current: `npm run isthmus` → `.cache/isthmus.png`
- Last session's comparison (may be gone): `/tmp/transito-opts/cmp/`, with `0-authored-game-map.png`, `1-procedural-before.png`, `2-procedural-now.png`. To re-render the old procedural map, use a detached `git worktree` at `c376cc4` with `node_modules` symlinked. To render the authored map, run `python3 tools/render_map_preview.py`, then pad the SVG to a square before `qlmanage -t`.

## Rules that apply
- Project `transito/CLAUDE.md`: specs first, pure world code, no new dependencies without approval, only Act 1 gets detailed streets/buildings/missions, don't touch the story, commit/push only when I ask. Remote host must be `github-personal`; `gh` needs `GH_TOKEN=$(gh auth token --user josuecm13)`.
- Any visual claim: render and look before saying it's done. Check the views I'll actually open. The Chrome extension didn't respond last session. No dev server is running now (I had it stopped); start one only when someone will look, and stop it after.
- Guards get mutation-checked: break the thing → red, restore → green. If a rule is enforced in two places, mutate both.
- 16 GB laptop: one heavy process at a time. Node tests run capped (`--max-old-space-size=1536 --test-timeout=120000`), one file at a time after big changes. zsh doesn't word-split `$VAR` commands: use a shell function.
- Pillow is installed in the user site (`python3 -m pip install --user`). Under `python3 -I` add `sys.path.append(site.getusersitepackages())`.
- Proving a refactor doesn't change the map: fingerprint before and after with `.claude/orchestrator/tools/fp.ts`.
/orchestrator
