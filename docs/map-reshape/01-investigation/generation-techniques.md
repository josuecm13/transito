# Generation techniques: literature and practice

Deterministic, spec-driven generation of terrain, rivers, settlements, regions and validation
metrics for a 6 x 8 km map at 2-10 m cells, in a browser. Proposal only; nothing here is a spec
decision. Fit = fit for TRÁNSITO (H/M/L).

## TL;DR

- Terrain: do not adopt a full erosion sim. Composite authored features (ridge/river curves ->
  distance fields) over the existing noise model, then one cheap stream-power-style pass for
  drainage coherence. Controllability beats realism here.
- Rivers: derive them from the heightfield with priority-flood + D8 accumulation, but authored
  river polylines stay the source of truth; carve with width ~ Q^0.5 and a floodplain profile.
- Settlements: suitability field (slope, height, water distance, flood, access) -> threshold +
  morphology -> town polygon. This replaces `active_area.rect`. Roads via slope-cost Dijkstra.
- Regions: ridges and rivers are barriers in a cost metric; Voronoi/watershed on that metric.
  Chokepoints are guaranteed by authoring a small gateway graph, not by luck.
- Validation: viewshed, tortuosity and isochrones are all cheap on a 5 m grid and deterministic.
  Make them the acceptance tests for "feels bigger".
- Everything fits in one worker pass (< 1 s at 5 m for 48 km^2 = ~2 M cells) except full erosion.
- Determinism rule for all of it: integer hash noise (as `terrain.ts` already does), fixed
  iteration order, no `Math.random`, no float-order-dependent parallelism, tie-break by index.

## What the generator does today (read-only survey)

| Layer | Today | Gap the reshape needs |
|---|---|---|
| Terrain (`src/world/terrain.ts`) | Coastal ramp + rolling Perlin + authored radial hill masks + flatten zones + street grading, baked grid, bilinear query | No ridge lines, no river valleys, no drainage; hills are radial blobs |
| Streets (`src/world/streets/`) | Tensor-field streamlines (formal), growth (informal, Parish & Muller style), faces -> blocks -> parcels | Districts are placed by rect, not by suitability; roads ignore relief except final grading |
| Spec | `world.yaml`: `relief:`, `street_styles`, `active_area.rect` | No `rivers:`, no `ridges:`, no settlement mask |

## 1. Terrain from sparse authored constraints

| Technique | Idea | Inputs -> outputs | Cost | Determinism | Fit |
|---|---|---|---|---|---|
| Hydrology-based models, [Genevaux et al. 2013](https://www.cs.purdue.edu/homes/bbenes/papers/Genevaux13ToG.pdf) | Generate a river tree from a sketch first, then build the terrain as analytic kernels around it (rivers are consistent by construction) | river graph + params -> continuous analytic height | Low: evaluation per query is local | Good: pure function of the graph | H (concept), M (full method is heavy) |
| Diffusion of feature curves, [Hnaidi et al. 2010](https://perso.liris.cnrs.fr/egalin/Articles/2010-terrain.pdf) | Drawn curves carry height/slope/roughness; a multigrid diffusion (Poisson) fills the gaps; noise amplitude/roughness are diffused too | curves with attributes -> heightfield | Multigrid O(n); GPU in paper, ~50 ms-1 s CPU at 2 M cells | Fixed solver order and iteration count: deterministic. Float summation order must be fixed | H: the best match to "sparse authored constraints" (ridges, riverbeds, cliffs) |
| Uplift + stream power, [Cordonnier et al. 2016](https://hal.archives-ouvertes.fr/hal-01262376) | Painted uplift map -> stream graph -> steady-state erosion (stream power) -> DEM from blended kernels; user controls watersheds and ridgelines | uplift map -> drainage-coherent heights | Low in paper; a simple grid version (flow accumulation + implicit steady-state solve) is O(n log n) | Deterministic if flow routing tie-breaks are fixed | M: use the idea (uplift + drainage), not their kernel pipeline |
| Noise + domain warping | fBm of position warped by another fBm; breaks the "blob" look | seed -> heights | O(n * octaves) | Excellent with integer-hash gradient noise (already in repo) | H as detail layer; L as structure (no control) |
| Distance-field compositing | Each authored feature (ridge polyline, river polyline, hill disc) -> signed distance -> profile curve (smoothstep/exp) -> blend by max/smooth-max | features -> heights | O(features * cells) with a bounded window; distance transform O(n) | Excellent | H: generalizes today's radial hill masks to polylines. Cheapest, fully controllable |
| Thermal erosion (talus) | Move material downhill where slope > talus angle | heightfield -> smoothed heightfield | O(n * iters), 20-100 iters | Excellent if cells processed in fixed order, double-buffered | M: cheap polish; fixes steep noise artifacts on San Miguelito-like hills |
| Hydraulic (particle/grid, e.g. Mei et al. 2007 GPU shallow water) | Simulate rain, sediment, deposition | heightfield -> eroded field | O(n * iters), 100s of iters; GPU-friendly | Particle versions need a seeded RNG and sequential order; grid versions are deterministic but slow on CPU | L: realism gain small at 2-10 m for a game top-down view; hard to control; breaks authored sea level and street grading |

Trade-off summary for 48 km^2 (2 M cells at 5 m, 12 M at 2 m):

| Approach | Controllability | Realism | Runtime (browser worker, 5 m) | Verdict |
|---|---|---|---|---|
| Noise only (today) | low | medium-low | ~0.1 s | too blobby for ridges/rivers |
| Distance-field composite + noise | high | medium | ~0.3 s | baseline |
| + diffusion (Hnaidi) for ridge/valley skeleton | high | medium-high | ~0.5-1 s | recommended |
| + stream-power pass on top | medium | high (drainage) | +1-3 s | optional, bake offline |
| Full hydraulic erosion | low | high | 10+ s | skip; if wanted, bake offline and ship the grid |

## 2. Rivers

| Technique | Idea | Inputs -> outputs | Cost | Determinism | Fit |
|---|---|---|---|---|---|
| Priority-flood depression filling, [Barnes et al. 2014](https://arxiv.org/abs/1511.04463) | Grow inward from edges with a priority queue; raise pits to spill height; optionally label watersheds | DEM -> hydrologically sound DEM (+ labels) | O(n) ints, O(n log n) floats | Heap ties must be broken by cell index; then fully deterministic | H: needed before any accumulation; ~20 lines of pseudocode |
| D8 flow direction + accumulation | Each cell drains to steepest of 8 neighbours; accumulate area in topological order | filled DEM -> flow dir, area A | O(n) with a sorted pass | Deterministic with fixed neighbour order and tie-break | H: the default. Accumulation A is a proxy for discharge Q |
| D-infinity (Tarboton 1997) / MFD | Split flow between two/many downslope neighbours | DEM -> dispersive area | O(n) | Deterministic | L for channels (smears); M for floodplain/wetness maps |
| Hydraulic geometry, [Leopold & Maddock 1953](https://pubs.usgs.gov/publication/pp252) | Width w = a Q^b with b ~ 0.5, depth d ~ Q^0.4, velocity ~ Q^0.1 | A (as Q) -> width, depth | O(1) per cell | Pure | H: gives the Q^0.5 width the brief asks for; calibrate `a` so the main river hits the authored width |
| Channel carving with banks + floodplain | Along the river centreline subtract a profile: trapezoid channel (depth d, bank slope ~1:2), flat floodplain band (width ~ 5-10 w) at a gentle cross-slope, blended into terrain by smoothstep | centreline + w(s) -> height delta, water mask | O(length * band) | Pure | H |
| Authored-first rivers | River = hand-placed polyline in `world.yaml` with source and mouth; D8 only validates that it is downhill and sets discharge; terrain is graded to the river (like street grading today) | polyline -> monotone profile | O(length) | Pure | H: keeps "why does the river sit here" auditable |
| Meander synthesis | Displace the centreline by a band-limited sinusoid/Kinoshita curve, wavelength ~ 10-14 w, amplitude falls with slope; or spline + 1D noise | centreline, w -> sinuous line | O(length) | Seeded 1D noise: deterministic | M: adds tortuosity in the lowland reach only |
| Deltas / mangrove estuaries | Distributary tree at the mouth (split at angle 30-60 deg, widths by Q^0.5 sum rule), tidal band = land with height < tide range, mangrove mask = tidal band within x m of channels | mouth, Q -> branches, mask | O(branches) | Seeded splits | M: a small authored tree (2-4 branches) beats procedural |
| Bridge placement | Crossing of a road edge with a river polygon: bridge span = river width + 2 abutments; pick crossings by minimum width along the route; flat deck between abutment heights | road graph x river mask -> bridge segments | O(edges) | Pure | H: also the natural chokepoint generator |

Notes: carve before grading streets; fill sinks only on a scratch copy used for flow, never
on the playable heightfield (it would flatten lagoons and the coastal ramp).

## 3. Settlement placement and roads on terrain

| Technique | Idea | Inputs -> outputs | Cost | Determinism | Fit |
|---|---|---|---|---|---|
| Suitability field | S = w1*f(slope) * w2*g(height) * w3*h(dist to water) * flood * access, each term in [0,1]; multiplicative so any hard veto (steep, flooded) zeroes S | slope, height, river distance, flood height, road distance -> S in [0,1] | O(n) plus two distance transforms | Pure | H: the core of "relief dictates town limits". Weights go in the spec |
| Interest maps, [Emilien et al. 2012](https://perso.liris.cnrs.fr/egalin/Articles/2012-villages.pdf) | Iteratively drop a seed at the interest-map maximum, add its roads, update the maps; anisotropic "conquest" (slope-weighted growth) splits land into parcels | terrain -> seeds, roads, parcels | Iterations x O(n) | Argmax with index tie-break | H for placing town seeds; M for parcels (we already have faces -> parcels) |
| Slope-cost roads, [Galin et al. 2010](https://perso.liris.cnrs.fr/egalin/Articles/2010-roads.pdf) | Weighted anisotropic shortest path: edge cost = length * (1 + k*(slope/s0)^2) + water/forest penalties, k-neighbourhood (e.g. 16-32) for smooth paths; bridges/tunnels as special edges | terrain, endpoints -> road polyline | Dijkstra/A* O(n log n) per route; 2 M cells, ~100-300 ms per route with a heap | Deterministic with index tie-break | H: for highways/arterials between towns; also gives true travel cost |
| Switchbacks | When the direct path exceeds the grade limit, fold the path: zigzag across the contour with legs at the max grade and 15-25 m hairpins. Cheap version: cap grade in the cost (infinite above limit) and let k-neighbourhood paths zigzag | path, max_grade -> switchback polyline | O(length) | Pure | M: needed only for the steep hill (San Miguelito) climb |
| Informal growth on hillsides | Existing informal growth (Parish & Muller 2001, [paper](https://cgl.ethz.ch/Downloads/Publications/Papers/2001/p_Par01.pdf)) with slope-aware local constraints: segments prefer contour-parallel direction, branch downhill, reject steps above grade | terrain + seeds -> streets | existing cost | Existing | H: reuse `informal.ts`; add a slope term to the growth direction and a suitability veto |
| Tensor field with terrain basis ([Chen et al. 2008](https://www.sci.utah.edu/~chengu/street_sig08/street_sig08.pdf)) | Add a basis field aligned with contours (or with the gradient) weighted by slope, so formal streets bend with relief | slope, aspect -> tensor basis | O(n) | Pure | H: a few lines on top of existing `tensor-field.ts` |
| Density falloff | density(p) = D0 * exp(-d_centre/L) * (1 - d_road-factor) * S(p); sets block size / building height / parcel fill | centres, roads, S -> density | O(n) | Pure | H: single scalar field feeding street spacing and building fill |
| Town boundary extraction | Threshold S at t, close (dilate r, erode r) to fill gaps, open to drop specks, drop components < A_min, take outer contour (marching squares) and simplify (Douglas-Peucker, 5-10 m) | S -> polygons | O(n) | Pure with fixed contour start | H: the replacement for the rect |

Order of operations: relief + rivers -> S -> seeds (argmax, min spacing) -> town polygons ->
inter-town routes (slope-cost) -> existing street generation clipped to each polygon.

## 4. Region separation and macro layout

| Technique | Idea | Inputs -> outputs | Cost | Determinism | Fit |
|---|---|---|---|---|---|
| Voronoi / power diagram, barrier-aware | Assign each cell to the nearest seed under a cost metric (multi-source Dijkstra / fast marching) where crossing a ridge or river costs extra; power weights size regions | seeds, barrier map -> region id map | O(n log n) | Index tie-break | H: regions follow ridges and rivers without hand-drawn borders |
| Watershed segmentation | Basins from priority-flood labels (Barnes) or flow-accumulation outlets; merge small basins up to a size | DEM -> basin ids | O(n log n) | Deterministic | H: natural separators; ridge lines = basin borders. Good for validating, and for choosing which ridges to author |
| Graph-based layout with chokepoints | Author a coarse graph (regions = nodes, passes/bridges = edges). Generate barriers so the only crossings are the graph's edges; validate with min-cut = 1-2 and BFS | graph -> barrier placement + gateway sites | O(V+E) + one flood fill | Pure | H: the only method that guarantees chokepoints. Gateways become bridges/passes (sections 2-3) |
| Poisson-disc seeds | Blue-noise seed placement with min distance r | rng -> points | O(n) | Seeded | M: for ordinary secondary seeds |

Validation: label the walkable-cell flood fill with barriers blocked; assert the number of
connected components equals the intended count and that each gateway reconnects exactly the
intended pair (mutation check: delete one gateway, expect the test to go red).

## 5. Perceived-scale math for validation

| Metric | Computation | Output / target use | Cost | Determinism | Fit |
|---|---|---|---|---|---|
| Viewshed / line of sight | For observer at eye height h_e, step the ray over heightfield samples; visible if the maximum tangent so far <= the target's tangent. Cumulative-horizon sweeps give a full viewshed in O(n * rays) | visible area, longest sightline per observer | A ray of 2 km at 5 m = 400 steps; 360 rays = 144 k samples per observer | Pure, fixed sampling | H: "sightline length" and "landmark visibility" targets |
| Skyline occlusion | Per observer, horizon elevation angle by azimuth; mean angle = enclosure | enclosure index; high = canyon, low = open | same | Pure | M |
| Route tortuosity | T = path length / Euclidean distance between endpoints (road graph shortest path) | T in 1.2-1.6 reads as winding without being tedious (starting band, to calibrate from real routes) | Dijkstra | Pure | H: direct measure of "bigger than it is" |
| Travel time / isochrones | Dijkstra over the road graph with speed per class (and slope penalty); time to every node; isochrone = level set | seconds from hub to each town; area within 1, 2, 3 min | O(E log V) | Pure | H: target e.g. >= 3 min by moto between far towns while the map is 6 x 8 km; sets the design speed |
| Route time / crow-flight time | Ratio of the route time to straight-line time at the same top speed | > 1.5 means the geography is taxing the player | O(1) after Dijkstra | Pure | H |
| Visual complexity | Per-tile entropy of land use / building heights; edge density (street km per km^2, already in `street-metrics.ts`); height-field roughness (std dev of slope) | tile score; flag tiles under a band as "empty" | O(n) | Pure | M |

Reference bands should be measured from the real fragments already baked in `specs/map/fragments/`
(same pattern as `street-metrics.yaml`), not invented.

## Recommended toolbox

Adopt:

1. Distance-field feature compositing (ridges, valleys, hills) over the existing noise model.
2. Diffusion/Poisson skeleton (Hnaidi) only if distance fields look too stiff; try compositing first.
3. Priority-flood + D8 accumulation on a scratch copy, for validation and river discharge.
4. Authored river polylines + Leopold-Maddock widths + channel/floodplain carving; small authored delta.
5. Suitability field -> threshold -> morphology -> polygon for town limits.
6. Slope-cost Dijkstra (Galin) for inter-town routes; slope term in tensor field and informal growth.
7. Barrier-aware Voronoi/Dijkstra regions + a hand-authored gateway graph, with a connectivity test.
8. Validation suite: viewshed, tortuosity, travel time, with bands from real fragments.
9. Optional thermal erosion pass (20-50 iterations, fixed order) as polish.

Skip:

- Full hydraulic erosion and full Genevaux/Cordonnier pipelines: too heavy and too uncontrollable
  for the payoff; borrow only their ideas (river-first, uplift + drainage).
- D-infinity / MFD for channels (keep D8; MFD only for wetness maps if needed).
- Procedural delta and meander generators beyond a seeded sinusoid: author them.
- Emilien building grammars and parcels: the repo already has faces -> parcels -> buildings.

Open points for the director: whether rivers are authored (recommended) or emergent; whether
any baked offline grid (erosion output) is acceptable under "no runtime import of real data"
(it is generated, not real data, so probably yes); the tortuosity and travel-time target bands.

## Sources checked

Fetched/searched in this pass: Genevaux 2013, Hnaidi 2010, Cordonnier 2016, Barnes 2014, Galin
2010, Emilien 2012 (abstract-level only, method details beyond the abstract not read in full).
Cited from memory, URLs not re-verified: Parish & Muller 2001, Chen et al. 2008, Leopold &
Maddock 1953, Tarboton 1997, Mei et al. 2007. Complexity and runtime figures for the browser are
estimates, not benchmarks.
