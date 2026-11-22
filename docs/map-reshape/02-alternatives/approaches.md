# 02 — Whole-pipeline approaches

Common spine (all three): layer outputs are pure functions of `world.yaml` (+ baked reference files under `specs/map/refs/`),
seeded, deterministic, each layer reading only earlier layers. Detail per layer in `../03-technical/`.

## Layer order and the three places where "reads only earlier layers" needs a rule

| Tension | Resolution proposed (all approaches) |
|---|---|
| Jungle (1) is realistic only if it knows slope, water and mangrove tide band, but relief (2) and rivers (3) come later | Layer 1 uses only the coast distance field, authored zones and noise (a **prior**). A cheap **re-mask** (water, riparian, slope) is applied inside the consumers' read, not as a new layer; or the director allows a 1b pass (Question 6) |
| Rivers (3) come from relief (2), but carving a valley changes relief | Relief outputs base height `H0`. Layer 3 outputs polylines + a **carve delta**; final height `H = H0 + carve_rivers + carve_canal + flatten_airports`. Terrain consumers read `H`. `terrain.ts` already composes base + flatten + pads + street grading in that style |
| Airports (4) before main roads (5) but need flat land; main roads need the airports as destinations | Airports flatten via a layer-4 delta; main roads read airports as nodes (terminals) |
| `geometry.land` has no hole for Gatún Lake, no canal inlet | New `water_bodies` spec for the lake (interior water, silhouette unchanged); `isPlayableLand` then excludes it (needs a code change, in the feature list) |

## A. Authored macro + procedural detail; real numbers as bands only

| Item | Content |
|---|---|
| Idea | The director/agents author every macro element in `world.yaml` (river polylines, canal, main roads, airports), procedural code fills detail and carves terrain; real data only supplies **numbers** (tortuosity, spacing, junction counts, shares) that become test bands. This is the current `map-from-reality` rule |
| Pros | Fits the rules as written; no ODbL geometry in the repo beyond what exists; every placement is a visible decision ("why does the river sit here"); smallest data work |
| Cons | Authoring ~7 rivers, canal, lake, 4-6 main roads and airports by hand is slow and tends to look "drawn"; hard to know if a hand-drawn Interamericana is plausible without a real overlay; bands can be gamed |
| Risk | Medium: plausibility rests on judgement; the real overlay is missing |
| Cost | Low data cost, medium authoring cost (spec + 3-4 days of agent work for layers 1-5 by my estimate, not measured) |

## B. Warped real geometry as the skeleton + procedural detail

| Item | Content |
|---|---|
| Idea | Bake real polylines (canal, Chagres/Gatún lake outline, rivers, Interamericana, Corredores, Autopista Panamá-Colón, Cinta Costera, runways) offline, warp them into the existing silhouette with anchor pairs, commit them as the macro skeleton, and generate detail around |
| Pros | Recognisable by construction (a Panamanian would see the real topology); free tortuosity and junction topology; no hand drawing |
| Cons | The warp is **not shape-preserving here**: see the fold test below; warped roads cross the authored coast and need re-snapping; compressed real roads are too long or have too many interchanges for 6 x 8 km (Autopista Panamá-Colón 117.5 km of ways vs 5.7 km of the map's `transisthmian-highway` route, computed from its points); much real geometry (ODbL) enters the repo; the result is a distorted copy of reality, against "never copy 1:1" in spirit; any anchor change re-warps everything |
| Risk | High: fold artefacts, licence exposure, silhouette conflicts |
| Cost | Highest data and tool cost (warp tool, snapping, hand fixes per feature) |

## C. Hybrid: authored anchors are the truth; real geometry is a baked reference and a first draft

| Item | Content |
|---|---|
| Idea | One table of **anchor pairs** (real lon/lat -> map x,y; canal mouths, locks, Colón, Casco, Tocumen, Bridge of the Americas...) is the single source. A dev-time tool warps real polylines through it **only to produce overlays and first drafts** that the director edits into authored routes. Rivers are D8-derived on the generated relief with authored outlets; roads are slope-cost routes between authored nodes. Real warped geometry is used for **metrics** (tortuosity, spacing, junction counts, crossing counts, ordering) and a preview overlay, not shipped as game geometry |
| Pros | Real topology is checked, not copied; authored decisions stay auditable; the warp can fold without breaking the game (it is a ruler, not a source); real geometry stays out of runtime data (small baked reference files only) |
| Cons | Two representations to keep (authored route + reference); the reference warp inherits the fold issue, so it needs a fold check and only shows partial overlays; a bit more tooling than A |
| Risk | Low-medium |
| Cost | A + one dev-time warp tool + reference bakes (Overpass JSON, no new dependency) |

## Evaluation of "real compressed geometry as references"

### Which warp

| Method | Behaviour | Good for | Problem here |
|---|---|---|---|
| Piecewise-affine over a triangulation of the anchors | Exact at anchors, straight lines stay straight inside a triangle, C0 only; folds if any triangle's orientation flips | Exact path of a few features near anchors; cheap and explainable; every triangle can be checked (determinant sign) | Sensitive to anchor placement; kinks at triangle edges |
| Thin-plate spline (smooth radial basis) | Exact at anchors, smooth (C1), minimises bending | Smooth overview of rivers/roads; no kinks | Overshoots and folds under strong anisotropy (E-W 1:60 vs N-S 1:6.8 in `real-geography.md`); no guarantee of staying inside the coast |
| Authored route (no warp) | Exactly what the director draws | Auditable decisions | No real check |
| D8 on the generated relief | Rivers that agree with the terrain; reproduces real rivers 84-97 % on real terrain (`real-geography.md`) | Rivers, drainage, basins, bridge-worthy crossings | Course is emergent: needs authored outlets and a carve to match a wanted path |

### Computed fold test (this pass)

I took the 11 anchor pairs already implied by the spec (`macro-summary.json` anchors and spec landmarks: Colón, Gatún locks,
Gamboa, Miraflores, Casco, Bridge of the Americas, Albrook, Punta Pacífica, Costa del Este, Tocumen terminal, Panamá Viejo;
real positions in an equirectangular frame) and counted, over **all 165 triples**, how many have opposite orientation in
reality vs the map (a necessary condition for a fold in some triangulation).

| Anchor set | Triples | Flipped | Examples |
|---|---|---|---|
| all 11 | 165 | 18 (11 %) | (Colón, Casco, Albrook), (Miraflores, Albrook, Tocumen), (Casco, Costa del Este, Tocumen) |
| without Albrook | 120 | 10 | (Casco, Pacífica, Tocumen), (Colón, Gamboa, Bridge) |
| without Albrook and Panamá Viejo | 84 | 7 | |
| without Albrook, Colón, Gatún | 56 | 7 | all around Casco / Costa del Este / Tocumen |

Meaning: the spec stacks the isthmus north-south and runs the bay almost east-west, so **any warp of the real isthmus into this
silhouette folds near the bay** (the Tocumen end). Anchors are partly from my memory (Bridge, Panamá Viejo); the test is a
necessary condition only (a given Delaunay triangulation might avoid some triples). Piecewise-affine would need the offending
anchors moved or dropped; TPS would hide the fold as an overshoot. This is the strongest argument against B and for using
warped reality only as a **reference with a fold check**.

### What each is good for

| Source of a path | Exact path | Tortuosity | Spacing / junction counts | Topology (who joins whom) | Auditable |
|---|---|---|---|---|---|
| Warped real polyline | partly (folds) | **measure it from the unwarped real line**, warp distorts | measure unwarped | yes | medium |
| Authored route | yes | by author | by author | yes | **high** |
| D8 on generated relief | emergent | emergent, compare to band | emergent | by outlets | high |
| Real **unwarped** polyline (reference only) | no | **yes** | **yes** | yes | high |

Conclusion: take **metrics from the unwarped real polylines** (tortuosity, interchange spacing, river spacing, crossings),
use the warp only for **preview overlays and first drafts**. No path from reality is needed to be exact.
