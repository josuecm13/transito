# Map Studio: what each edit changes (causality matrix)

Measured 2026-11-25 (lake rows re-checked after the tolerance fix) with the protocol (`dryRun`, cell 20 m, one tower district present). A stage "changed" when its
fingerprint in `hashes` differs from the baseline. Reproduce with `describe → patch/set-*/move-anchor dryRun`.

| Edit | height | lake | rivers | roads | towns | transit | districts | Result |
|---|---|---|---|---|---|---|---|---|
| `set-ridge cordillera width 2000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | whole map re-derives (lake area held at 5 km²) |
| `lake.target_km2` 5 → 4.5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | relief is shared; lake 4.5 km², 30 stations |
| `move-anchor stop:transit:casco` | | | | | | ✓ | ✓ | **towns unchanged**: stations move, the density they carry moves with them |
| `set-district la-ciudad 2.0 km²` | | | | | ✓ | ✓ | ✓ | urban 3.34 → 3.54 km²; metro follows the built-up ground |
| tower district `sigma` 600 | | | | | | | ✓ | only the district field; dense core 0.25 → 0.63 km² |
| `lake.target_km2` 5.8 | refused | | | | | | | guard `routes-connected`: the `gamboa` stop is pushed 210 m from its authored place (limit 200 m) |
| `lake.target_km2` 9 | refused | | | | | | | generator throws (`gamboa-road` unreachable): reported as `generation failed`, state kept |
| `towns.airport_buffer` 3000 | refused | | | | | | | guards `airport-buffer` and `airport-detached-from-core` |

Reading: terrain edits touch everything; town edits touch towns → transit → districts; station and district edits never
recompute terrain, roads or towns (the district model is refined after the routing, so there is no cycle).

## Verdicts are the same at every cell

Guards run on the generated map, and coarse cells change the map (airport 5170,2620 at 20 m vs 5330,2780 at 40 m), so
hashes and previews are per cell. The verdicts must not be: the `routes-connected` tolerance was `6 × cell`, which made the
unedited map fail at 20 m (the authored `gamboa` stop already sits ~175 m inside the flood zone and is snapped to dry land)
and pass at 40 m, so edits passed at 20 m only because "no new violation" was compared with an already-red baseline. It is
now a flat 200 m (`ROUTE_END_TOLERANCE_M`): the unedited map is valid at 20 and 40 m, and `lake.target_km2 = 5.8`
(the issue's example) is refused at both, because it pushes the stop 210–251 m from its authored place.
`save` validates at the authored cell (20 m) unless `"cell"` is passed; `validatedAtCell` is in its response.
