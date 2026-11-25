# Map Studio: what the math controls do

Every control is a key of `procedural:` in `specs/map/world.yaml`; `describe` returns its range, unit and this explanation
(`src/studio/params.ts` is the table). Ranges are enforced before generation; the strict parser enforces structure.
Causality, measured: [`map-studio-causality.md`](map-studio-causality.md). Pipeline order (each stage reads only earlier ones):

```
relief → lake → rivers → canal → airport → roads → towns → transit → districts → cover
```

## World

| Control | Unit | Effect |
|---|---|---|
| `relief.seed` | int | A different mountain layout over the same ridges (the 🎲 button). Everything downstream re-derives |
| `relief.background` | | Uplift away from every ridge: higher = hillier lowlands |
| `relief.peak` | m | Height of the highest land |
| `relief.erosion.iterations`, `.k` | | Stream-power passes and erodibility: deeper, more branching valleys |
| Map extent (6000 × 8000 m) | | **Locked.** Changing it needs a rescale policy for the authored coast (open question) |

## Land & water

| Control | Unit | Effect |
|---|---|---|
| `relief.zones[*].width`, `.rate`, `.radius` | m, – | Ridge zones (`line`: polyline + width; `disc`: centre + radius). Wider/stronger = a broader, taller mass; watersheds move |
| `relief.coast_taper` | m | Distance over which uplift fades to the sea: wider coastal plains |
| `relief.hummocks.amplitude` | m | Low hills on valley floors; flooding turns their tops into lake islands |
| `lake.target_km2` | km² | Area flooded behind the dam. 1–15 allowed; large values fail guards (5.8 km² floods the `gamboa` road) |
| `lake.snap_radius`, `.min_inland` | m | Where the dam may sit |
| `rivers.min_area_km2`, `.max_width` | km², m | Smallest drawn drainage and widest river |
| `canal.width`, `.depth` | m | Channel size. The three canal anchors are **pinned** |

## Places

| Control | Unit | Effect |
|---|---|---|
| `towns.items[*].target_km2` | km² | Built area the town grows to (cost-distance growth from its seeds, suitability-weighted) |
| `towns.items[*].road_affinity`, `seed_along.reach`, `patches.*` | | How closely a town follows its road, how far a ribbon may spread from it, unbuilt gaps |
| `towns.road_discount`, `towns.separation`, `towns.airport_buffer` | –, m, m | Growth step-cost near roads; unbuilt ground between towns; keep-out around the airfield (see the note below) |
| `suitability.max_slope` | m/m | Slope at which ground stops being buildable |
| `airport.*` | m | Search radius around the hint, runway length and spacing |
| `districts.items[*]` | m, – | Influence of a district (`sigma` reach, `weight` strength, negative pushes density away) |
| `districts.*` | | Station boost, coast boost, access falloff, footprint threshold, airport core gap |

District density, refined after towns and transit so terrain, roads, towns and tracks are never recomputed:

```
D(p) = clamp( S(p) · G(p) · [ Σ w_i · exp(−(d_i/σ_i)²) · (1 + w_coast · C(p))  +  w_transit · T(p) ], 0, 1 )
S suitability (0 on water, steep ground, rivers, mangrove, the airfield and its buffer)
G access: floor + (1 − floor) · exp(−(d_road / range)²)
C coast: exp(−(d_sea / coast_sigma)²), a multiplier inside districts only (never a bayfront sprawl by itself)
T transit: max over metro stations of exp(−(d_station / transit_sigma)²)
```

No items = the field is zero and the map is exactly the towns + transit result. Dense core = D ≥ 0.5; footprint = D ≥ `footprint`.
Styles (`historic-core`, `tower-cluster`, …) are metadata for #7 street generation, not geometry.

**`airport_buffer` and seeds.** The buffer makes the surroundings unbuildable for *growth*, but a town's seed cell is built
whatever its suitability when no suitable cell lies within `seed_snap`. El Corredor's three seeds lie on the Interamericana
towards the airport terminal, so with a large buffer 3 built cells remain 36 m or more from the field (guard `airport-buffer`
fires, correctly). Not fixed in this branch (see the run file).

## Connections

| Control | Unit | Effect |
|---|---|---|
| `roads.stops.*`, `transit.stops.*` | m | Where routes and metro lines attach; moving one reroutes them. The metro stations move with the stop and carry their density (towns do not change) |
| `roads.routes[*].stops` | ids | The stops a route visits. Líneas stay as authored: `linea-2-unchanged` keeps the two-branch reading (#12 open question) |
| `transit.lines[*].station_spacing` | m | Target distance between stations |

Rules the guards enforce on any combination: one connected reservoir; rivers reach water; the canal joins both seas; no towns or
runways on water; the airport is detached from towns and from dense cores; routes reach their stops within 200 m; transport
crosses water only on bridges; ≥ 60 % of the land stays wilderness; pinned places stay on land.
