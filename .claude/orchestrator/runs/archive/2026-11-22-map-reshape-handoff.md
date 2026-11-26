# Handoff — map from reality, relief, street seed, map reshape plan (2026-11-21 → 22)

Context for the next session. Everything below is a **hypothesis to verify** against the repo
before acting on it (global CLAUDE.md: "Inherited claims are hypotheses"). Nothing is committed.

## Read first

- `CLAUDE.md` (this repo): director rules, one act at a time, specs first, original content,
  Spanish story / English code, no commits unless asked.
- Global `~/.claude/CLAUDE.md` → **"Use the machine's resources mindfully"**. The previous session
  used up the 16 GB of RAM and the Mac had to be restarted. Hard limits: at most 2 background
  agents and at most 1 heavy; agents never start dev servers or browsers; Node tests are capped
  (`node --max-old-space-size=1536 --test --test-timeout=120000`), one file at a time while code
  is half-finished; containers run only while they are used. Never change the Colima config
  (official client setup).

## Repos and services

| What | Where | State |
|---|---|---|
| Game | `~/Documents/personal-projects/transito` | 26 files modified + new untracked files (below), uncommitted |
| Geospatial engine | `~/Documents/personal-projects/geospatial-reconstruction-engine` | New `docker-compose.override.yml` (uncommitted): `db` capped at 2 GiB with smaller Postgres buffers; the showcase `client` now only starts with `--profile client`. Validated with `docker compose config`, not yet observed running (`docker stats`). |
| Engine data | PostGIS volume `postgis_data` in the default Colima VM | Holds all imports (see the registry below). Colima is stopped. |

Start the engine only when it's needed: `./scripts/dev-up.sh`, then from `server/`:
`source .venv/bin/activate && set -a && source .env && set +a && uvicorn app.main:app --port 58000`.
Stop it afterwards: `./scripts/dev-down.sh --colima`. Game: `npm run dev` (port 5173), with
`?spawn=<landmark>` (only landmarks inside the active area work).

## Done (verified at the time)

1. **Fragments.** Six 800 m Panama corridor fragments (samaria, torrijos-carter, pedregal,
   juan-diaz, tocumen, las-mananitas), plus `la-carpio` (the existing import, San José CR, the
   informal-barrio analogue, chosen on purpose) and `la-carpio-seed` (700 m, engine
   frontage-lots generation run done). Registry: `specs/map/fragments/index.yaml`; profiles:
   `specs/map/fragments/<slug>.yaml`. OSM building coverage in the Panama barrios is very sparse
   (1–45 buildings per fragment), so building fingerprints come from La Carpio. The CLI also ran
   `--generate` on the six Panama fragments (generation runs stored in the engine database;
   removable with `DELETE /import-areas/{id}/generation`).
2. **Skill + CLI.** `.claude/skills/map-from-reality/` (workflow steps 0–7 plus 4b "seed streets +
   fill buildings") and `npm run geo` (`search`, `import`, `register`, `profile`, `status`;
   `tools/geo-fragments.mjs` + `tools/geo-fragments-lib.ts`, `tests/geo-fragments.test.ts`).
   Profiles re-run byte-identical; 10/10 tests pass, mutation-checked by the agent.
3. **Map reshape plan, steps 0–1.** `docs/map-reshape/`: `README.md` (index; read on demand),
   `00-brief.md`, `01-investigation/{current-map, real-geography, san-andreas-techniques,
   generation-techniques}.md`, `assets/` (macro previews + summary JSON). Probe:
   `node tools/probe-macro-relief.mjs` (tile cache in `.cache/`, already in .gitignore).
   **Missing:** `01-investigation/README.md` (the index links to it).

### Key findings (from the investigation docs; the numbers are in each doc)

- The rectangle is one setting (`active_area.rect`, world.yaml) but about 18 places read it, and
  districts built from 1 km grid cells add straight internal borders that the street generator
  treats as walls. `playable_boundary` exists but barely touches Act 1; its `barrier` strings are
  never read.
- The real corridor is a flat coastal apron backed by a 150–450 m hill wall. **Rivers are the
  real separators**: 7 rivers run N→S, 2–5 km apart in reality. The terrain probe's D8 network
  reproduces Juan Díaz, Tocumen, Tapia, Las Lajas, Abajo, Matías Hernández and Curundú at 82–97%
  of their OSM courses. The east drains into one mangrove estuary. The spec has no rivers, no
  wetland and no hill wall.
- The real corridor runs east-northeast, but the spec draws it as a north-south strip. The fit
  gives about 1:6.3 with a 63° rotation; compression across the isthmus has to be per-axis.
- San Andreas is about 36 km² against our 48 km²; its sense of size comes from technique. The doc
  lists 17 techniques, each with a proposed metric and band, all to calibrate (tortuosity
  1.25–1.6, viewshed ≤ 15% of the map, 400–1200 m gaps between towns, fog, gating by closed
  crossings…).
- Recommended toolbox: composite authored ridges, rivers and hills as distance fields over noise;
  priority-flood + D8; Leopold–Maddock river widths; a suitability field (threshold +
  morphology) replaces the rect; slope-cost roads; barrier-aware regions with a gateway graph;
  viewshed, tortuosity and isochrones as acceptance tests.

## Interrupted: partial work in the tree (three build agents stopped mid-task)

The agent transcripts belong to the old session. Re-brief from the file state; you can't resume
them.

| Work | Files | Known state |
|---|---|---|
| **Relief** | `src/world/terrain.ts`, `src/world/drape.ts`, `relief:` in world.yaml, `src/plugins/{world-physics,world-view,player,vehicle,pedestrians,camera-follow,landmark-triggers}.ts`, `src/engine/{meshes,physics}.ts`, `src/world/world-data.ts`, README Relief section(?) | Calibration targets: hills — Samaria slope p50 16% / p90 30%, Torrijos-Carter 8.5% / 27%; mid and south corridor — Pedregal 6.3/12.7, Juan Díaz 4.5/8.5, Tocumen 6.0/10.8, Las Mañanitas 8.5/16.5. Rule: match real slope, not height. Completion unknown. |
| **La Carpio street seed** (director's top priority) | `tools/bake-street-seed.mjs` + `-lib.ts`, `specs/map/seeds/`, `src/world/streets/seed.ts`, edits in `generate.ts`, `informal.ts`, `planar-graph.ts`, `index.ts`, world.yaml `street_styles.districts.tito-corridor.seed`, `tests/street-seed.test.ts` | `street-seed.test.ts`: 1 failing test — "avenues split the seed" (`avenue / seed junction nodes: 2`, test line 223). The seed anchor/rotation default is a director decision. |
| **Frontage-lots port** | `src/world/streets/frontage-lots.ts`, edits in `buildings.ts`, `city.ts`, `tests/streets-frontage-lots.test.ts`, `tests/frontage-check.ts`, `tests/city-check.ts`, `tests/streets-parcels.test.ts`, world.yaml `blockout` | **Memory culprit:** `tests/streets-frontage-lots.test.ts` reached **3.3 GB RSS** in 110 s even with `--max-old-space-size=1536` and exited 1, with no output. Most likely unbounded memory outside the V8 heap or a runaway loop. Fix this before running the full suite. |
| Stray | `tools/.dbg-tmp.ts` | Debug leftover from an agent; delete once confirmed unused. |

### Test hunt (one file at a time, 1.5 GB cap, 120 s kill)

- 34 files run: all pass except the two above. Peak RSS for the rest was ≤ 180 MB.
- **Not run yet:** streets-parcels, streets-planar-graph, streets-realism, streets-tensor-field,
  triggers, vehicle, walk-graph, world-data, world.
- `npm run typecheck` and `python tools/render_map_preview.py` haven't been run on the combined
  tree.

## Next steps (in order, respecting the resource limits)

1. Finish the test hunt for the 9 remaining files. Then run typecheck and the map validator.
2. Fix the frontage-lots memory blow-up: profile it in isolation with a small block set, find the
   unbounded structure or loop, and add a guard (max lots per edge, per block).
3. Fix the street-seed avenue-split failure. Then confirm realism (corridor still inside the
   La Carpio band) and determinism.
4. Finish the relief integration. One heavy agent at a time, in this order: street seed →
   frontage-lots → relief.
5. Plan steps 2–4: write `01-investigation/README.md`, then `02-alternatives/` (2–3 approaches
   plus a recommendation), `03-technical/` (one file per utility: inputs, formula, parameters,
   defaults, test, metric band), `04-features/` (ids, priority, act, dependencies, acceptance
   criteria). Docs-only agents are light, so one can run alongside a heavy one.
6. Only when the director wants to look: start one dev server, then stop it afterwards.

## Decisions pending (director)

- Act 1 "scale down": crop (build less now, same map) or rebudget (the corridor takes less of the
  48 km² for good; recommended).
- Where the La Carpio seed lands (anchor, rotation, mirror).
- Whether to move the corridor's realism reference from La Carpio (whole area: 157
  intersections/km²) to Panama fragments (Torrijos-Carter 264, Tocumen 233, Las Mañanitas 219;
  the La Carpio seed core is 263).
- Corridor orientation (about 63° rotation, per the real-geography fit) and per-axis compression.
- Rivers authored (recommended) or derived from the terrain; gating by closed crossings; hard
  fog or soft haze.
