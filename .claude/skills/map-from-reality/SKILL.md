---
name: map-from-reality
description: Take inspiration from real Panama places for the TRÁNSITO map without copying reality 1:1. Searches real places in the geospatial-reconstruction-engine, imports small fragments (800 m, at most 2 km²), profiles streets, road classes, buildings, block fill and relief, and turns the numbers into spec proposals (street widths from class, block and lot sizes, slope distribution, seed streets, building fingerprints). Use when the director says "inspírate en un lugar real", "importa un fragmento", "perfila Samaria / La Carpio / Tocumen", "qué pendientes tiene X", "npm run geo", "usa datos reales para el mapa", or when a map, street, relief or building-blockout spec needs real numbers.
---

# Map from reality

Real places feed **numbers**, never geometry. The game never imports or fetches real data at
runtime; specs decide, code follows, and the director owns map and story decisions.

## Hard rules

1. **Compress by dropping repeated fabric**, never by shrinking blocks, streets or buildings.
2. **Street widths come from class** (`street_profiles` / `street_styles.hierarchy`), not measured lanes (OSM lane tags are sparse; check `lane_tag_coverage`).
3. **Relief matches the real slope distribution** (p50/p90/p99 %), not absolute heights. Compressing 1:4 to 1:9 horizontally while keeping real heights would make slopes 4 to 9 times steeper.
4. **Building blockout** (lot width/depth, front setback, side gap, frontage fill) comes from fill fingerprints of a well-mapped fragment.
5. **Record inspiration** in `inspired_by`; keep "© OpenStreetMap contributors" provenance (profiles carry it).
6. **Spec first.** Propose spec changes to the director; do not edit `world.yaml` on your own initiative. No new dependencies, no commits unless asked.

## Workflow

0. **Engine up.** `curl -s localhost:58000/import-areas | head -c 100`. If down: `../geospatial-reconstruction-engine`, `./scripts/dev-up.sh`, then from `server/` activate the venv, source `.env`, `uvicorn app.main:app --port 58000` (see its `docs/runbook.md`). The CLI prints this when the engine does not answer.
1. **Find.** `npm run geo -- search "Tocumen"`. Pick one small fragment per texture (hills, flat informal grid, market street, airport edge), at most 1 km², default 800 m.
2. **Import.** `npm run geo -- import <slug> <lat> <lon> [--size 800]` (refuses > 1414 m; reuses an import with the same bbox). `register <slug> <import_area_id>` adopts an existing engine import. Registry: `specs/map/fragments/index.yaml`.
3. **Profile.** `npm run geo -- profile <slug|all> [--generate]` writes `specs/map/fragments/<slug>.yaml` (rerun with no change is byte-identical). Read `buildings.data_quality` first. `--generate` runs the engine's auto fill (seed 1) only when asked; it writes derived data in the engine.
4. **Translate** with the hard rules; table of sections to spec fields in `references/profile-to-spec.md`.
4b. **Seed streets + fill buildings.** Choose a well-mapped analogue fragment (La Carpio, `la-carpio-seed`). Bake it offline with `npm run bake-seed` (`tools/bake-street-seed.mjs`) into `specs/map/seeds/`: the corridor's informal generator grows from it (mirrored/rotated, real scale, ODbL attribution, never fetched at runtime). Place it with `street_styles.<district>.seed`. Set the `blockout` fingerprints in `world.yaml` from the profile's `fill` section (engine `frontage-lots-v1`, ported in `src/world/streets/`). Validate against the realism band. Those tools are owned by other agents: use the commands by name, do not edit their files.
5. **Propose** spec changes to the director (numbers + which fragment + caveats). Story and map decisions are his.
6. **Generate and validate.** `python tools/render_map_preview.py`, `npm run typecheck`, `npm test` (realism bands in `tests/streets-realism.test.ts`). Any new guard is mutation-checked: break what it protects, see it fail, restore, see it pass.
7. **See it in game.** `npm run dev`, open `/?spawn=<landmark>`.

## Data caveats

- **Panama corridor barrios are barely mapped in OSM for buildings.** Samaria 28, Torrijos-Carter 14, Las Mañanitas 1 building per 0.64 km²; Juan Díaz, Pedregal and Tocumen are also sparse. Building fingerprints must come from a well-mapped analogue like La Carpio, and the write-up must say so. Their streets and relief are usable.
- The engine does not import footways, paths or steps: alley density of informal barrios is understated.
- Fingerprints exist only for blocks with enough real buildings; `fill.styles` says when the run used defaults.
- Elevation is AWS terrain tiles (about 5 m cells here): slope p99 is noisy at that resolution.

## References

| File | Load when |
|---|---|
| `references/profile-to-spec.md` | translating a profile into spec numbers |
| `specs/map/README.md` ("Streets", "Fragments") | the street model and the CLI files |
| `tools/geo-fragments.mjs`, `tools/geo-fragments-lib.ts` | CLI usage; pure statistics (tests in `tests/geo-fragments.test.ts`) |
