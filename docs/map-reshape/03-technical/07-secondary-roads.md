# 03.07 — Layer 6: secondary roads (active-act area only)

## Inputs
Layers 1-5 (relief `H`, water, airports, main roads as fixed avenues); spec `street_styles.districts.<id>` (style, spacing/growth);
the district regions (today grid cells, see `current-map.md` section 1).

## Algorithm
Secondary roads are the **collector class** of the existing hierarchy (`collector: width 10, sidewalk 2.5`): the roads that
join main roads to districts.
1. Take main-road junction stubs and the district rim.
2. Formal districts: tensor-field streamlines at `spacing.collector` (existing `streamlines.ts`), plus a **terrain basis** (contour-aligned
   weighted by slope; Chen et al. 2008) so collectors bend with relief.
3. Informal districts: existing growth, with a slope veto (reject steps above `max_grade`) and a river/ridge barrier test.
4. Collectors are generated before locals (existing order: `generate.ts`).
Today this layer is mixed inside `generate.ts` with layer 7; the plan is to expose collectors as their own step so layer 7 reads layer 6.

## Parameters (defaults, existing)
`hierarchy.collector` 10 m + 2.5 m sidewalks; formal `spacing.collector` 420 m (costa-del-este) / 600 m (airport); informal
`segment_length` 40-110 m, `branch_probability` 0.30, `snap_radius` 15, `min_angle` 30. New: `collector_max_grade` 0.12.

## Proposed spec
```yaml
street_styles:
  districts:
    tito-corridor:
      collector: { max_grade: 0.12, terrain_basis: { weight: 0.5, slope_from: 0.03 } }
```

## Pure test
Existing `streets-generate.test.ts` / `streets-informal.test.ts` stay green. Add: every collector segment grade <= 0.12;
no collector crosses a river polygon without a bridge from layer 5; every collector connects to a main-road node or another collector.

## Metric band
Real reference for secondary roads outside La Carpio/Santa Ana: **TBM** (OSM `highway=secondary|tertiary` spacing from the
Geofabrik/Overpass extract in the corridor). Until measured, use the existing frozen whole-network bands (see 03.08).

## Kept / replaced
Kept: collectors and their generator. Replaced: nothing; split out as a separate step. Depends on Question 3 (seed or fresh).
