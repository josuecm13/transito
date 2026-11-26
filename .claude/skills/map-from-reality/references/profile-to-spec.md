# Profile section → game spec

| Profile section | Read | Spec target | Note |
|---|---|---|---|
| `streets` | `block_area_median_m2`, p10/p90, `intersections_per_km2`, `street_km_per_km2`, `dead_end_share`, `t_share`, `x_share` | `street_styles.districts.<id>.reference` and `street-metrics.yaml` (`npm run references`) | same definition as `src/world/street-metrics.ts`; with few blocks (< 10) the quantiles are weak |
| `road_classes` | km share per class | which hierarchy classes the district uses and in what mix | widths come from the game class, never from measured lanes; `lane_tag_coverage` is usually near 0 |
| `buildings` | footprint p10/p50/p90, levels | footprint and height ranges of the blockout | trust only when `data_quality` starts with `ok`; else use a better-mapped fragment |
| `fill` | `lot_width_m`, `lot_depth_m`, `front_setback_m`, `side_gap_m`, `frontage_coverage`, `median_levels` per `style` (regular, sparse, informal) | `blockout` fingerprints in `world.yaml` | `*_iqr_m` gives the spread; empty `styles` means defaults, not measurements |
| `relief` | `slope_p50_pct`, `slope_p90_pct`, `slope_p99_pct`, `relief_m` | relief section of `specs/map/README.md` | match the slope distribution; derive game heights = slope x game horizontal distance |
| `pois` | counts by kind | hints for landmarks only | never copy names or places 1:1 |

Compression check: a game hill of horizontal length L_game with slope p90 s needs height s x L_game,
not the real height. Real relief is a sanity bound, not a target.

Write findings to the director as: fragment slug, numbers, which rule they feed, caveat (data_quality).

El Corredor fill rule: the `fill` fingerprint (`frontage_lots`) must come from a well-mapped San Miguelito or surrounding Panama square (>= 1000 buildings/km2 AND >= 8% footprint cover; tools/geo-fragments-lib.ts SPARSE_BUILDINGS_PER_KM2 / SPARSE_FOOTPRINT_COVER: a square is sparse if it fails EITHER). Scan candidate squares first; never copy numbers from a sparse fragment (torrijos-carter 14 buildings, juan-diaz 45, ...); never import Costa Rica (La Carpio is NOT used, director's decision 2026-11-26); if no square reaches the threshold, STOP and ask the director. Outputs feed the section profile (`specs/map/sections/<id>.json`); densities are stored clipped to the sample box.
