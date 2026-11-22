# 03.10 — Layer 9: buildings (active-act area only)

## Inputs
Layer 8 buildable blocks, relief, `blockout:` per district, landmarks (clearance 18 m).

## Algorithm
Existing: `method: parcels` (one centred building per parcel) or `method: frontage-lots` (buildings along each block's frontage
from a measured fingerprint; `frontage-lots.ts`, 481 lines). `buildings.ts` extrudes greybox. Addition: building floor height =
terrain height at the footprint (existing), foundation on slope, and building height damped on slope > 0.25 (informal
hillside reads as stacked low houses).

## Parameters (existing)
`blockout.districts.tito-corridor`: `method: frontage-lots`, fingerprint width median 9.0 m (IQR 4.5), depth 12.2 (5.5),
front setback 1.1, side gap 0, coverage 0.98, two-storey share 0.3, level height 3 m, jitter 8 deg / 1 m. Airport:
lot 70, footprint 20-45, height 6-14. Costa del Este: lot 40, footprint 14-24, height 20-60.

## Proposed spec
Unchanged, plus `slope_height_damp: { from: 0.25, to: 0.45, factor: 0.5 }` (proposal).

## Pure test
Existing `streets-frontage-lots.test.ts`, `blockout.test.ts`. Add: footprints inside buildable area, none over water, none within
landmark clearance.

## Metric band
Frontage coverage 0.98 (La Carpio median of block medians, engine run `a249a461-...`, OSM buildings). Data caveat from the skill:
Panama corridor barrios are barely mapped for buildings, so fingerprints come from La Carpio (Costa Rica) and say so.

## Kept / replaced
Kept: both methods, fingerprint, greybox. Added: slope damping.
