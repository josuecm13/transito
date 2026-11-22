# 03.06 — Layer 5: main roads (Interamericana, Transístmica, coastway)

## Inputs
Layers 1-4: relief `H` (slope cost), water (rivers, canal, lake: crossings), airports (terminals as destinations),
land cover (forest/mangrove cost); spec `main_roads:` nodes and classes; anchors; baked reference metrics.

## Algorithm
1. **Nodes** (authored): hubs and gateways (Bridge of the Americas, Casco, Paitilla, Tocumen terminal, Colón, edge gateways).
2. **Edges** (authored list of node pairs, class, grade limit). Existing hand-drawn `routes` of kind `highway` / `arterial` are
   **fixed constraints** and become edges with `fixed: true`.
3. **Route**: for each non-fixed edge, anisotropic Dijkstra / A* on the 16 m grid, 16-neighbourhood, cost
   `length * (1 + k*(slope/s0)^2) + water + forest + mangrove penalties`, infinite above `max_grade`, index tie-break
   (Galin et al. 2010). Simplify (Douglas-Peucker 8 m) then smooth (Chaikin, 2 passes) without leaving the grade limit.
4. **Crossings**: at each road x river/canal/lake polygon intersection choose a bridge (span = water width + 2 x abutment 15 m,
   deck height = max of abutment heights + clearance). The canal gets `clearance` for ships (Bridge of the Americas).
5. **Interchanges**: place junction nodes where main roads cross, spacing >= `min_interchange`.
6. **Topology test input**: who-joins-whom graph of hubs.
7. Output: centrelines with class, width (`street_profiles`), bridges, grade profile; layer 7+ treat them as fixed avenues (exactly as
   `corridor-avenue` today).

### The coastway (Cinta Costera) as a layer-5 feature
| Part | Spec | Rule |
|---|---|---|
| Boulevard | `kind: arterial`, offset `inland` from the shore (the existing `coastal-avenue` already runs 300-400 m inland of the shore in the city, e.g. y=1200 at x=2700 vs shore 685) | follows `geometry.land` at constant offset (like a `coastline` tensor element) |
| Linear park | land-cover class `park_reclaimed` in the strip between boulevard and shore, relief cap like `costa-del-este` (`cap: 3` m) | layer 1 + 2 read the `coastway.strip` polygon (declared in spec) |
| Marine viaduct | `kind: viaduct` (elevated deck on piles) offshore from the old-quarter tip: only the bay side fits (map has <= 100 m sea south of the tip) | offset seaward 80-120 m from the shore, deck height `H_sea + 6` m, piles every 25 m (visual) |
| Corredor Sur | `kind: highway`, elevated or at grade, hugging the shore from Paitilla to the airport shore; may run on a `causeway` offshore | `max_grade 0.04`, interchange every 1.5-2.5 km (proposal band) |
Existence and scope of viaduct and Corredor Sur: Question 10. Act: skeleton is whole-isthmus (layer 5); the Casco street pattern
and towers are not.

### The Interamericana and the Transístmica
| Road | Proposed route (map) | Notes |
|---|---|---|
| Interamericana | Bridge of the Americas (1300, 400) -> Balboa/Albrook edge -> city (about (3100, 1900)) -> corridor (4600, 2400) -> east gateway near (5900, 2300) | Replaces or absorbs `corridor-avenue` west half (Question 7). The real through-chain in the city (named `Carretera Panamericana` ways exist west of the canal and east of Tocumen; the city link is a chain of other names) must be traced offline from the route relation: **not verified in this pass** |
| Transístmica (Panamá-Colón) | existing `transisthmian-highway` (2500,6500)-(3500,5500)-(4300,4300)-(4500,3400)-(3000,2200), 5.7 km (computed), joins the city at (3000, 2200) | real Autopista Panamá-Colón is 117.5 km of OSM ways (dual carriageway, so about 59 km per direction); map ratio about 1:10 (real 59 km vs 5.7 km, rough) |
| Corredor Norte (optional) | Albrook (1800, 1800) -> inland arc -> joins Transístmica/corridor | real 57.4 km of ways, starts at Albrook per OSM extents; Question 10c |

## Parameters (defaults)
| Name | Default | Unit |
|---|---|---|
| `max_grade` highway / arterial | 0.06 / 0.10 | rise/run (proposals; existing street grading max 0.22) |
| `k`, `s0` | 4, 0.08 | cost shape |
| `min_interchange` | 1500 | m |
| `abutment` | 15 | m |
| `viaduct_offset` | 100 | m |
| profiles | highway 24, arterial 14 (+3 sidewalk) | m, existing `street_profiles` |

## Proposed spec
```yaml
main_roads:
  nodes:
    - { id: bridge-americas, at: [1300, 400], kind: bridge, inspired_by: "Bridge of the Americas" }
    - { id: paitilla,        at: [3500, 1020], inspired_by: "Punta Paitilla" }
    - { id: tocumen-term,    at: [5600, 1700], landmark: passenger-terminal }
    - { id: east-gateway,    at: [5900, 2300], kind: gateway }
  edges:
    - { id: interamericana-1, from: bridge-americas, to: paitilla, class: highway, via: [[1900, 1100], [2800, 1500]] }
    - { id: transistmica, route: transisthmian-highway, fixed: true }
  coastway:
    id: cinta-costera
    inspired_by: "Cinta Costera 1-3, Avenida Balboa"
    boulevard: { route: coastal-avenue, offset_from_shore: 330 }
    strip: { kind: park_reclaimed, cap_height: 3 }
    viaduct: { enabled: true, side: bay, offset: 100, deck_above_sea: 6, around: old-quarter }   # Question 10b
    corredor_sur: { enabled: true, from: paitilla, to: tocumen-term, elevated: true }          # Question 10a
```

## Pure test
(a) Grade limit holds on every segment; (b) every crossing has a bridge and no road meets water without one; (c) **topology**:
BFS over the hub graph reaches Bridge -> Casco -> Paitilla -> Tocumen -> Colón (mutation: delete one edge, test red);
(d) coastway boulevard stays within `offset +- 25 m` of the shore along its length and the strip polygon is on land;
(e) viaduct is entirely over water; (f) tortuosity and interchange spacing in band.

## Metric band
| Metric | Real | Source |
|---|---|---|
| Road lengths (sum of ways) Autopista Panamá-Colón 117.5 km, Panamericana 95.4 km, Corredor Norte 57.4 km, Corredor Sur 37.3 km, Cinta Costera 3.4 km (+0.7), Balboa viaduct 1.8 km, Bridge of the Americas 1.7 km | as listed | Overpass this pass (`open-data-sources.md`) |
| Tortuosity (route / straight) | TBM from unwarped refs | proposal band from `san-andreas-techniques.md`: city-to-city 1.25-1.6 (a proposal, not measured) |
| Interchange spacing | TBM | proposal 1.5-2.5 km |
| Order along the bay (topology) | Casco, Cinta Costera, Paitilla, Pacífica, Panamá Viejo, Costa del Este | `panama-city-signature-places.md` |

## Kept / replaced
Kept: `routes` kinds, `street_profiles`, avenues as fixed constraints, `BARRIER_KINDS`, `coastal-avenue`,
`transisthmian-highway`, `corridor-avenue`. New: nodes/edges, slope-cost router, bridge chooser, coastway, viaduct kind.
