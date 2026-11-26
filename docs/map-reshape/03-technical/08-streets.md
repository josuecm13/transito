# 03.08 — Layer 7: streets (local, alley; active-act area only)

> 2026-11-26: El Corredor is built by the section generator (`src/world/streets/section/`), see `specs/map/README.md` "Section profiles"; the text below describes the earlier design where it differs. `informal.ts` and `streets-informal.test.ts` were deleted.

## Inputs
Layer 6 collectors + main roads (fixed), relief, rivers (barriers), land cover (no streets on water/forest outside settlement
masks), spec `street_styles` incl. optional `seed`, `land_use`, `reference`.

## Algorithm
The generator (`src/world/streets/generate.ts`, `tensor-field.ts`, `planar-graph.ts`, `section/`):
formal = tensor-field streamlines; `section` = built from a section profile (earlier design: Parish & Müller-style growth
from a seed rim, retired); planar graph; faces -> blocks.
Changes: (1) district regions come from a polygon/label field instead of grid cells; (2) the `area` frame follows the
outline, not the rect (`current-map.md` items 8-10); (3) growth reads the slope veto from layer 6.
Seed: La Carpio fragment stays under Question 3.

## Parameters
Existing and unchanged (`street_styles.districts.*`). New: none.

## Proposed spec
Unchanged; `reference:` blocks stay.

## Pure test
Existing `tests/streets-realism.test.ts` (bands with negative controls, 9/10 seeds in band as of the snapshot),
`streets-generate.test.ts`, `section-generate.test.ts` (`streets-informal.test.ts` was retired with the grower). Add: blocks tile the land mask (sum of block + street areas = land area, as
the snapshot shows 3,592,937 vs 3,592,940 m2).

## Metric band (frozen, `specs/map/street-metrics.yaml`)
| Metric | La Carpio | Santa Ana | Band default |
|---|---|---|---|
| Block area p10 / median / p90 (m2) | 2,572 / 6,053 / 14,729 | 485 / 4,305 / 15,211 | median +-35 %, p90 +-50 % (La Carpio 45 % / 60 %) |
| Dead-end / T / X share | 0.30 / 0.60 / 0.10 | 0.225 / 0.632 / 0.143 | +-0.08 absolute (La Carpio 0.10) |
| Intersections per km2 | 156.9 | 161.9 | +-30 % |
| Street km per km2 | 19.5 | 15.9 | +-30 % |
| Mean segment (m) | 93.5 | 67.4 | reported |
Source: engine imports, OSM, "© OpenStreetMap contributors" (extracted 2026-10-31). Known gap: footways/alleys missing in La Carpio.

## Kept / replaced
Kept: everything. Replaced: the rect/grid region definition (follow-up of the reshape).
