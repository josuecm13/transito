# Run 2026-11-22 (session 3, part 3): the map from procedures

## Goal

Director accepted a vision image (`~/Downloads/Mapa del Istmo_ Canal y Cordillera.png`) plus a metro/railway sketch, and
asked to "step back, research math techniques for procedural maps, and create functions that do those procedures
instead of generating them yourself". By the director's choice, built directly in the main session (an exception to the
orchestrator's never-implement rule, for this work only).

## Result

- `src/world/proc/`: grid, noise, hydrology (priority-flood + Braun-Willett stream power), relief, lake (flood behind a
  dam), water (rivers + canal as cheapest excavation), airport (flattest site), paths (A*, smoothing), roads (slope cost),
  settlements (suitability + per-town cost-distance growth), transit (metro + railway), cover, render, png, params, isthmus.
- `tools/render-isthmus.ts` / `npm run isthmus` → `.cache/isthmus.png` (~6 s generate, 1 s render).
- `tests/proc-isthmus.test.ts`: 7 guards, all mutation-checked (see the doc's table). Typecheck clean.
- Doc: `docs/map-reshape/01-investigation/procedural-techniques.md`.

## Not done / open

- Not wired into `src/world/layers/` or the game; params not in `world.yaml` yet (specs first, after the director accepts the look).
- Supersedes C4/C5's authored lake polygon and radial-hill relief; their terrain bands (`tests/terrain.test.ts`) are not
  re-calibrated against the new relief.
- Visual gaps against the vision: fewer lake islands; no text labels in the PNG; Línea 3's north spur ends in forest;
  airport heading (100°) differs from the sketch (NNE); Gamboa barely grows.
- Línea 2 interpreted as two branches (Balboa–Casco–bay east, north hub–El Corredor–airport); confirm with the director.
