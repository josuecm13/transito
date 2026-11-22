# 03.11 — Landmark anchors (real places as inspiration)

Short file: how a real place becomes an **anchor** (a named, placed landmark with a silhouette) without being copied.
Candidates and positions: `../01-investigation/panama-city-signature-places.md`.

## Rules
| Rule | Detail |
|---|---|
| Working name + `inspired_by` | The map name is a working name; the real place goes only in `inspired_by` (CLAUDE.md "Contenido original") |
| Order and side, not metres | Anchors keep the real order along the bay and the real side of water/hill; each gap has its own ratio |
| Silhouette contract | Each anchor states the 1-3 features that make it readable top-down (peninsula tip, linear park strip, tower point, arch over channel) and the layer that produces each (cover, relief, road) |
| On land (or `on_water`) | Point-in-polygon against `geometry.land` (and water bodies); the existing spec validator already enforces this for landmarks |
| Anchor vs fill | Anchor = unique silhouette + name; fill = carried by district rules and cover |
| Detail follows act | Skeleton (layers 1-5) is whole-isthmus; streets/buildings/interiors of a place follow the act that uses it |

## Proposed spec (extends existing `landmarks:`; fields not present today marked)
```yaml
landmarks:
  - { id: panama-ruins,   district: city-core, x: 3900, y: 1020,  kind: historic, inspired_by: "Panamá Viejo ruins", anchor: true, notes: "grey block outside the Act 1 rect" }
  - { id: bio-museum,     district: pacific-locks, x: 1480, y: 330, kind: civic, on_water: true, inspired_by: "Biomuseo, Amador Causeway", anchor: true }
  - { id: ancon-hill,     district: pacific-locks, x: 1900, y: 950, kind: nature, inspired_by: "Ancón Hill", anchor: true }
  - { id: bayfront-market, district: city-core, x: 2740, y: 760, kind: commercial, inspired_by: "Mercado de Mariscos", anchor: false }
```
`anchor` and `inspired_by` on landmarks are **proposed schema additions** (`parseWorldSpec` is strict). The `district` of each
point must match the grid cell containing it (existing rule). Checked: (3900, 1020) is cell (col 3, row 6) = `K`; (1480, 330) and
(1900, 950) are `B`; (2740, 760) is `K`. Points with y < 1000 and x 3000-4000 fall in `S` cells (sea budget) although the shore
is land from y about 555 to 925: the budget grid and the shore disagree there, so city anchors on that stretch sit at y >= 1000
(or the grid gets edited, it is only an area budget).

## Pure test
Each anchor on land / on water as declared; `inspired_by` present; bay-order test: sort anchors along the shore parameter
(arc length along `geometry.land` south coast) and assert the real order Casco < Cinta Costera < Paitilla < Pacífica < Panamá Viejo <
Costa del Este. Mutation: swap two anchors, test red.

## Metric band
Gaps in the table of `panama-city-signature-places.md` (real vs map ratio per segment, all from OSM positions where marked).
