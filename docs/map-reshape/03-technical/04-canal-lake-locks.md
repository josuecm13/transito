# 03.04 — Layer 3b: Panama Canal, Gatún Lake, locks

## Inputs
Layers 1-2; rivers (Chagres feeds the lake; layer 3a); spec `canal:` and `water_bodies:`; anchors (locks, Colón, Gamboa).
Real facts (not re-measured here; general knowledge to verify in the bake): canal about 80 km, Gatún Lake surface about 26 m
(`real-geography.md`), locks lift ships between sea and the lake in steps (Gatún three steps, Pedro Miguel one, Miraflores two),
old chambers about 305 x 33.5 m, Neopanamax chambers about 427 x 55 m **[memory]**.

## Algorithm
1. **Centreline** = existing `routes.canal` polyline (authored; Atlantic end west of Pacific end is kept on purpose,
   `specs/map/README.md`).
2. **Channel polygon**: offset by `width/2` (120 m today as `street_profiles.waterway`), mouths flare to the bays.
3. **Lake polygon** = authored polygon inside land (the `L` budget cells, 8 km2) with islands generated inside by seeded
   blue-noise + the relief; lake level `lake_level` flat; shore = `H0` crossing `lake_level` (flood-fill so the lake is
   a basin, not a plane).
4. **Locks**: at each lock site (anchor) a stepped reach: chambers = rectangles of `chamber` size along the centreline with gates;
   water level per chamber from `steps` (heights scaled by the relief rule: slope matters, not metres); flat concrete apron
   `apron` around it.
5. **Heights**: `carve_canal` lowers the channel to `sea_level` on the Pacific/Caribbean reaches and to `lake_level` in the lake
   reach; dam/spillway not modelled.
6. Output: water polygons with level, lock chambers, bridge-clearance info for layer 5 (the Bridge of the Americas and the cable
   bridge cross the channel here).

## Parameters (defaults)
| Name | Default | Unit |
|---|---|---|
| `width` | 120 | m (existing profile) |
| `lake_level` | 12 | m in map heights (real 26 m, scaled by `k_h`; **proposal**) |
| `chamber` | 305 x 34 | m (kept real: never shrink structures) |
| `steps` | pacific 2, atlantic 3 | count |
| `apron` | 60 | m |

## Proposed spec
```yaml
canal:
  route: canal                 # existing waterway route = centreline
  width: 120
  lake_level: 12
  locks:
    - { id: miraflores,  at: [1400, 1500], inspired_by: "Miraflores locks", steps: 2, chamber: [305, 34] }
    - { id: atlantic,    at: [500, 6500],  inspired_by: "Gatún locks",      steps: 3, chamber: [305, 34] }
water_bodies:
  - { id: gatun-lake, kind: lake, inspired_by: "Gatún Lake", polygon: [[0, 3900], [1500, 3500], [3000, 3900], [3000, 5900], [0, 5900]], islands: { seed: 41, count: 12 } }
```
(polygon is a placeholder from the `L` budget cells; the director authors the real outline; it must stay inside `geometry.land`.)

## Pure test
Channel polygon inside land except at mouths; lake polygon inside land, `lake_level` below every shore cell and above the
channel's Pacific level; chambers fit between gates along the centreline; locks at the declared anchors; the canal is
a barrier for streets; **connectivity**: canal links both bays (BFS over water cells). Mutation: shorten the lake polygon so it
no longer touches the channel, connectivity test red.

## Metric band
| Metric | Real | Source |
|---|---|---|
| Canal width in the cut | not measured here | TBM (OSM canal polygon, Overpass) |
| Lake surface height | about 26 m | `real-geography.md` |
| Lock step counts and chamber size | as above | memory, verify at bake |
| Bridge crossings of the canal in the isthmus | Bridge of the Americas (1.7 km span), Centennial, Atlantic bridge | OSM names; counts TBM |

## Kept / replaced
Kept: `routes.canal`, `waterway` kind, landmarks `pacific-locks`, `atlantic-locks`, `arch-bridge`, `cable-bridge`
(move onto the channel, Question 8). Replaced: the 120 m line-only canal by polygon + lake + locks.
