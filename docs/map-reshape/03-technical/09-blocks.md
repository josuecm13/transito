# 03.09 — Layer 8: blocks (active-act area only)

## Inputs
Layer 7 planar graph (faces), main roads and secondary roads as boundaries, water/slope masks, spec `land_use`.

## Algorithm
Existing: faces of the planar street graph minus half street width + sidewalk = buildable area (`faces.ts`, `buildable.ts`);
`land-use.ts` marks a fraction of blocks as `park` / `court`. Addition: blocks on slope > `no_build_slope` (0.35) or inside the flood
band (height below `flood_height`, default 1.5 m above sea) become `park_or_void` instead of buildable (suitability veto from
`generation-techniques.md`); riparian strips next to rivers are parks.

## Parameters
Existing `land_use: { park: 0.06, court: 0.03 }`. New: `no_build_slope` 0.35, `flood_height` 1.5 m.

## Proposed spec
```yaml
street_styles:
  districts:
    tito-corridor:
      land_use: { park: 0.06, court: 0.03, no_build_slope: 0.35, flood_height: 1.5 }
```

## Pure test
Existing `streets-faces.test.ts`, `streets-parcels.test.ts`. Add: no buildable block with mean slope above `no_build_slope`;
blocks do not overlap water polygons.

## Metric band
Block area bands as in 03.08 (La Carpio median 6,053 m2, Santa Ana 4,305 m2). Share of blocks vetoed: TBM (new).

## Kept / replaced
Kept: faces, buildable, land-use. Added: terrain/water veto.
