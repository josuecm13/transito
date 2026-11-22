# 02 — Recommendation

## Recommendation

**Approach C (hybrid).** Authored anchors and routes are the source of truth in `world.yaml`; real data is baked offline as small
reference files (Overpass JSON, terrain tiles; no new dependency) and used for **metrics, overlays and first drafts**, never as
runtime geometry. Generate layers 1-5 over the whole isthmus at low resolution outside the active area, and layers 6-9 only in
the Act 1 area. Rivers are D8-derived on the generated relief with authored outlets; main roads are authored nodes joined by
slope-cost routes; the coastway (Cinta Costera) is a main-road + land-cover feature. Keep the La Carpio seed and
frontage-lots for layers 7-9 in the corridor unless the director says otherwise (Question 3).

Why not A: no real overlay to judge plausibility. Why not B: computed folds near the bay (see `approaches.md`), licence exposure,
and a distorted copy of reality.

Build order: foundation (spec shapes, validators, reference bake) -> layers 1-3 -> canal/lake -> airports + main roads
(incl. coastway skeleton) -> Act 1 detail layers 6-9 -> city detail later (see `../04-features/`).

## Claims checked against the repo (and what I could not verify)

| Earlier claim | Result |
|---|---|
| `current-map.md`: seed anchor (5000, 2600), rotated 40 deg | **Stale**: `world.yaml` now has `anchor: [5000, 2700]`, `rotation_deg: 165`, `mirror: true` (uncommitted work moved) |
| `current-map.md`: `terrain.ts` 474 lines | Now 508 lines (in flight) |
| Coast removes 0.76 km2 of the 8 km2 rect | **Verified**: land in rect 7.24 km2 by point-in-polygon at 10 m (my run) |
| `playable_boundary` east trims 0.46 km2, west is 3.6 km outside | Not recomputed (west x 0..400 vs rect from 4000 is trivially outside); east figure unverified |
| `real-geography.md`: map has Atlantic locks x 500, Pacific locks x 1400; canal is a route not in `geometry.land` | Verified in `world.yaml`; the canal ends at (1300, 0), coast passes (1250,350)-(1450,450) |
| `real-geography.md`: Corredores / Transístmica "none crosses the 400 m hills" | Could not verify; OSM extents measured (see `open-data-sources.md`) are consistent with the Pacific apron |
| `real-geography.md`: Colón-Casco 45 km N-S / 40 km E-W | Verified by arithmetic from its own coordinates |
| `real-geography.md`: corridor rotation 63 deg | **Dropped by decision 1** |
| `world.yaml`: `cable-bridge` (700,3300) `on_water` over the cut | **Inconsistent**: canal route at y=3300 is at x about 1262, about 560 m east; no lake/cut polygon exists |
| Runways: spec 2 x 1500 m, N-S, 700 m apart | Real Tocumen 3,056 m + 2,438 m, about 850 m apart, bearing about 29 deg (OSM, my computation): the spec airport is about 1:2 in length, N-S instead of ENE; not wrong, a compression choice to confirm (Question 9) |
| `san-andreas-techniques.md`: SA ratios, 1:50-1:100, cross-map times | Not verified (the doc grades them U/S); nothing new found. No developer source for freeway simplification exists in what I could reach |
| `generation-techniques.md` runtimes (<1 s at 5 m) | Not benchmarked here (estimates in the source) |
| `current-map.md` metrics (126 km streets, 10,490 buildings) | Not re-run (no tests/engine allowed); treat as snapshot |

## Proposed wording for CLAUDE.md rule 5 (NOT applied)

Current: "5. **El mapa también va por partes.** El istmo completo queda definido en `specs/map/world.yaml`, pero solo se detalla la
zona del acto activo; el resto puede existir como bloques grises."

Proposed:

> 5. **El mapa va por capas y por alcance.** El istmo completo se genera solo en las capas de naturaleza y red principal
>    (1 cobertura y selva, 2 relieve, 3 ríos y Canal, 4 aeropuertos, 5 carreteras principales), con la resolución que
>    permita el presupuesto fuera del acto activo. Las capas 6 a 9 (calles secundarias, calles, manzanas, edificios) se
>    generan y detallan solo en la zona del acto activo. Cada capa lee únicamente las anteriores. Fuera del acto activo no
>    hay misiones, interiores, personajes ni distritos detallados. `specs/map/world.yaml` sigue siendo la fuente de verdad y la
>    forma actual de la costa (`geometry.land`) no cambia sin decisión del director.

English gloss: whole isthmus gets layers 1-5 only; layers 6-9 only where the active act is; each layer reads earlier layers only;
no missions, interiors or detailed districts outside the active act; `world.yaml` stays the source of truth; the coast stays.

## Questions for the director

Only decisions that change what gets built. No answer is assumed.

1. **Main roads: warped real, authored, or hybrid?** Warp real polylines into the map as the skeleton (B), author every route
   and use real data only for numbers (A), or author routes with a warped real reference for checking and first drafts (C, recommended)?
2. **Real geometry in the repo (ODbL).** May warped or simplified OSM polylines (rivers, Interamericana, Corredores) be baked into
   `specs/map/refs/` with attribution (the street seed is already such an exception), or should only frozen numbers stay in the repo?
3. **La Carpio street seed (Track A).** Keep it as the seed for secondary roads and streets of `tito-corridor`, or supersede it with
   "generate layers 6-9 fresh from layers 1-5" and keep La Carpio only as a metric band?
4. **Far frame: hard fog or soft haze.** Hard fog lets layers 1-5 outside the active area be low resolution; soft haze that shows distant
   mountains requires visible far relief and cover (cost). Which?
5. **Gating.** With the whole isthmus generated, are closed crossings (canal bridges, locks) and invisible walls acceptable, or should
   barriers be soft (heat, reputation, wanted level)? This decides whether bridges and the canal need collision blockers.
6. **Layer purity.** Strictly "each layer reads only earlier layers" makes jungle (1) blind to slope and rivers. Allow a cover
   refinement pass after layers 2-3, or accept a plain prior?
7. **Interamericana vs existing routes.** May a new Interamericana (Bridge of the Americas -> city -> east past Tocumen) absorb the
   hand-drawn `corridor-avenue` and the `transisthmian-highway` city end, or must both stay as they are?
8. **Gatún Lake as water body.** May the spec add interior water (`water_bodies`: lake, canal inlet) without changing
   `geometry.land`, and the cable bridge landmark be moved onto the channel?
9. **Airports.** Keep the 1,500 m N-S runways (about 1:2 of Tocumen) or move toward real lengths (3,056 / 2,438 m, ENE) which needs
   more airport shore? Build a small Albrook-style airfield (room for about 1.0-1.1 km east of the canal) or only an anchor?
10. **Panama City bayfront.** (a) Does a Corredor Sur (expressway along the bay to the airport) exist? (b) Cinta Costera viaduct around
    the old quarter: the map leaves at most 100 m of sea south of the Casco tip, so build it on the bay side only, or nudge the tip
    (a silhouette change)? (c) Corredor Norte as a second expressway, or skip? (d) Which places are anchors (default proposal in
    `01-investigation/panama-city-signature-places.md`) and is Panamá Viejo placed at the K/E seam (3900, 1020), outside the Act 1 rect?
11. **Resolution outside the active area.** Accept 16-20 m cells and class-level cover for layers 1-5 outside the Act 1 rect, or
    require the 4 m terrain grid everywhere (memory and bake time)?
12. **CLAUDE.md rule 5.** Approve the proposed wording above (or edit it); it is not applied.

## Decided (2026-11-22)

Director answers to the twelve questions above, verbatim:

1. C hybrid
2. refs with ODbL yes
3. start over: corridor layers 6–9 generated fresh, La Carpio seed retired in I4 (files kept), La Carpio stays as realism band
4. soft haze
5. no new invisible walls; gating per act later
6. cover refinement pass after relief+rivers allowed
7. Interamericana absorbs corridor-avenue and the city end of transisthmian-highway
8. water_bodies yes, cable-bridge onto the channel
9. keep 2×1,500 m runways; Albrook landmark only
10. Corredor Sur yes, viaduct bay side, Corredor Norte no, anchors = proposed list
11. 16 m far grid yes
12. CLAUDE.md rule 5 wording pending the director

Land cover comes from OSM shares, no WorldCover.
