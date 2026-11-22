# 04 — Feature list

Five larger issues, one outcome each (director prefers fewer, larger issues). Priority P0 (blocks others) to P2 (optional).
Act tags: **frame** = whole-isthmus skeleton allowed by decision 3 (layers 1-5, no missions or detail);
**1** = active act; **2+** = city detail, kept out of the Act 1 issue (CLAUDE.md rule 3). Act numbers for the city come only from the
`notes:` already in `world.yaml`; the director confirms them.
All acceptance criteria are checkable by a pure test or a validator; every new guard is mutation-checked and the PR reports the
red run. Detail per layer: `../03-technical/`. Everything depends on the answers in `../02-alternatives/recommendation.md`.

## Issues (outcome, scope, order)

| Issue | Outcome | Layers | Act | Depends on |
|---|---|---|---|---|
| **I1 Foundation** | The spec can describe layers 1-5 and the validators/tests can check them; reference data is baked offline | cross | frame | Questions 1, 2, 12 |
| **I2 Nature** | The whole isthmus has cover, relief with ridges, derived rivers, the canal polygon, Gatún Lake and locks, inside the unchanged coast | 1, 2, 3 | frame | I1 |
| **I3 Airports + main roads** | Tocumen (and optionally an Albrook strip) are levelled and connected; the Interamericana and Transístmica skeleton crosses water by bridges | 4, 5 | frame (Tocumen is Act 1) | I2 |
| **I4 Act 1 detail** | Corridor + airport shore secondary roads, streets, blocks and buildings are generated from layers 1-5, in the realism bands | 6-9 | **1** | I3, Question 3 |
| **I5 City bayfront** | The Cinta Costera coastway skeleton (boulevard, reclaimed park strip, optional viaduct, Corredor Sur) and the landmark anchors along the bay exist as grey skeleton | 1, 2, 5 (+11 anchors) | skeleton frame; **detail 2+** (not in I4) | I3, Question 10 |

## Features

| id | Title | Layer | Pri | Act | Depends | Acceptance criteria (checkable) |
|---|---|---|---|---|---|---|
| **I1** | | | | | | |
| F01 | `anchors.yaml` + warp tool with fold check | cross | P0 | frame | none | `npm`-free tool outputs overlay SVG; fold test reports a swapped-pair mutation and passes the consistent set; 7-18 flipped triples reported for the 11 current anchors |
| F02 | Reference bake (`tools/bake-refs.mjs`, Overpass) | cross | P0 | frame | Q2 | `specs/map/refs/*.json` has provenance + ODbL attribution; rerun byte-identical; total < 1 MB; Interamericana, Corredores, Autopista, Cinta Costera, canal, runways present |
| F03 | Spec shapes (`land_cover`, `rivers`, `water_bodies`, `canal`, `airports`, `main_roads`, `anchors`) in `parseWorldSpec` + `render_map_preview.py` mirror | cross | P0 | frame | F01 | strict parser rejects unknown keys; validator fails (exit 1) on a river mouth off the coast (mutation) and passes after restore |
| F04 | Layer-contract test | cross | P0 | frame | F03 | test fails if layer N imports a later layer's output (mutation: add the import) |
| F05 | CLAUDE.md rule 5 wording | cross | P0 | frame | Q12 | director applies it; no agent edits CLAUDE.md |
| F06 | Reference metrics frozen (tortuosity, interchange spacing, river spacing, crossings) | cross | P1 | frame | F02 | `specs/map/refs/metrics.yaml` with method and bbox; recomputing gives identical numbers |
| **I2** | | | | | | |
| F10 | Land cover grid (prior) + read-time re-mask | 1 | P0 | frame | F03 | determinism test; no non-water class outside land; mangrove only inside `band`; shares inside band (WorldCover or OSM fallback, Q: dependency) |
| F11 | Relief ridges + far grid + whole-isthmus extent | 2 | P0 | frame | F10 | existing terrain tests green; ridge crest is the perpendicular local max; land slope p50/p90 within +-25 % of 6.4 / 22.8 %; build < 1.5 s |
| F12 | Rivers: flood, D8, carve, width law | 3 | P0 | frame | F11 | monotone descent on every river; mouths on coast; spacing band; D8 reproduces >= 80 % of real centrelines on real tiles; `waterway` barrier honoured by streets |
| F13 | Canal polygon, Gatún Lake, islands, locks | 3 | P1 | frame | F12, Q8 | channel inside land; lake basin below shore, above Pacific level; chambers 305 x 34 m at the lock anchors; BFS connectivity bay-to-bay; cable-bridge on the channel |
| **I3** | | | | | | |
| F20 | Airport layer: Tocumen levelling, taxiways, terminal node | 4 | P0 | 1 (frame skeleton) | F11, F12 | runway centreline spread <= 0.05 m; runway on land and clear of water; terminal reachable |
| F21 | Albrook-style airfield | 4 | P2 | frame | F20, Q9 | strip <= 1.1 km east of the canal, y < 3000, flat <= 0.05 m |
| F22 | Main-road router (slope-cost) + bridge chooser | 5 | P0 | frame | F12, F13 | grade limit on all segments; every road x water crossing has a bridge; no crossing without deck clearance over the canal |
| F23 | Interamericana (Bridge -> city -> east past Tocumen) + Transístmica as fixed route | 5 | P0 | frame | F22, Q7 | hub BFS reaches Bridge, Casco, Paitilla, Tocumen, Colón; deleting one edge turns the test red; tortuosity and interchange spacing within measured bands |
| **I4** | | | | | | |
| F30 | Collectors as their own step (terrain basis, slope veto) | 6 | P0 | 1 | F22, Q3 | existing street tests green; all collector grades <= 0.12; each connects to a main-road node |
| F31 | District regions from polygon/label field, outline frame | 7 | P0 | 1 | F30 | no rect/grid frame edges left in the corridor; spawn inside; blocks tile land (area sums equal) |
| F32 | Streets/blocks keep realism bands on the new layers | 7, 8 | P0 | 1 | F31 | `streets-realism` green (9/10 seeds, spec seed in band); negative controls still fail |
| F33 | Terrain/water veto for blocks; slope-damped buildings | 8, 9 | P1 | 1 | F32 | no buildable block over slope 0.35 or over water; footprints inside buildable area |
| **I5** | | | | | | |
| F40 | Coastway skeleton: boulevard at shore offset, `park_reclaimed` strip (cap 3 m) | 1, 2, 5 | P1 | frame (detail 2+) | F22, Q10 | boulevard within offset +-25 m of the shore along its length; strip on land; height <= 3 m |
| F41 | Marine viaduct on the bay side of the old quarter | 5 | P2 | frame (detail 2+) | F40, Q10b | viaduct entirely over water; deck 6 m above sea; piles every 25 m (visual only) |
| F42 | Corredor Sur (Paitilla to airport shore) | 5 | P2 | frame (Act 1 rect: skeleton only) | F22, Q10a | max grade 0.04; interchange spacing 1.5-2.5 km; ends at the airport terminal node |
| F43 | Landmark anchors along the bay (`anchor`, `inspired_by`) | cross | P1 | frame (detail 2+) | F03, Q10d | each anchor on land / on water as declared; district matches grid cell; bay-order test passes; swapping two anchors turns it red |
| F44 | Ancón Hill, Biomuseo, Panamá Viejo (grey blocks) | 2 | P2 | 2+ | F43 | hill slope inside band; ruins outside the Act 1 rect (x < 4000) |

## Not in any issue (explicit)
Casco street grid, Calle 50 towers, Vía España blocks, market interiors, Corredor Norte (unless Q10c yes): Act 2+ detail,
not Act 1; they are listed in `../01-investigation/panama-city-signature-places.md`, not scheduled.
