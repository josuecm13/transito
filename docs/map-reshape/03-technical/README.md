# 03 — Technical utilities (one file per layer)

Each file: inputs (earlier layers + spec fields), algorithm, parameters (defaults, units), proposed `world.yaml` shape
(**proposed, not applied**), the pure test, the metric band (real number + source), and what is kept or replaced.
All utilities are pure and deterministic: same spec + same baked references -> same output; integer-hash noise, fixed iteration
order, index tie-breaks, no `Math.random` (as `terrain.ts` already does).

| # | File | Layer | Scope |
|---|---|---|---|
| 0 | [`00-conventions-and-bake.md`](00-conventions-and-bake.md) | cross | grids, layer contract, reference bake, warp tool, test conventions |
| 1 | [`01-land-cover.md`](01-land-cover.md) | 1 | whole isthmus |
| 2 | [`02-relief.md`](02-relief.md) | 2 | whole isthmus |
| 3 | [`03-rivers.md`](03-rivers.md) | 3 | whole isthmus |
| 4 | [`04-canal-lake-locks.md`](04-canal-lake-locks.md) | 3 | whole isthmus |
| 5 | [`05-airports.md`](05-airports.md) | 4 | whole isthmus (Tocumen = Act 1) |
| 6 | [`06-main-roads.md`](06-main-roads.md) | 5 | whole isthmus, incl. the coastway (Cinta Costera) |
| 7 | [`07-secondary-roads.md`](07-secondary-roads.md) | 6 | active-act area |
| 8 | [`08-streets.md`](08-streets.md) | 7 | active-act area |
| 9 | [`09-blocks.md`](09-blocks.md) | 8 | active-act area |
| 10 | [`10-buildings.md`](10-buildings.md) | 9 | active-act area |
| 11 | [`11-landmark-anchors.md`](11-landmark-anchors.md) | cross | anchors from real places |

Reality bands marked **TBM** (to be measured) need the offline bake from `../01-investigation/open-data-sources.md`; I did not
download large data in this pass, so those numbers are not invented here.
