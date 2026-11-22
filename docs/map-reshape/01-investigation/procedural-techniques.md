# Procedural techniques: the isthmus from functions, not drawings

Director, 2026-11-22: the accepted vision is a natural, uneven map (dendritic Cordillera, Gatún as a drowned valley
with islands, ragged towns, El Corredor as a ribbon to the airport, a metro and the Panamá–Colón railway). Method: research
the maths of procedural maps and write functions that do it, instead of drawing shapes. This file maps each feature of
the vision to a technique, a formula and the function that implements it in `src/world/proc/`.

**Status:** working prototype, not wired into the game layers yet. Parameters live in `src/world/proc/params.ts` and
move into `specs/map/world.yaml` once the director accepts the look (CLAUDE.md: specs first).
Render: `npm run isthmus` → `.cache/isthmus.png` (gitignored). Guards: `tests/proc-isthmus.test.ts`.

**Evidence:** formulas come from the papers below. Only Barnes et al. 2014 was opened in this pass; the rest are cited
from memory (`[memory]`). Numbers are starting values tuned against the vision image, not measured constants.

## Pipeline (each stage reads only earlier stages)

```
coast (authored, geometry.land) ─► relief ─► reservoir ─► rivers + canal ─► airport ─► main roads
                                                                                        │
                       land cover ◄── towns (suitability + growth) ◄────────────────────┘
                                         └──► metro + railway
```

Authored input is coarse intent only: uplift zones, dam / lock / airport hints, town seeds with target areas, route
and line stops. Every shape is computed.

## 1. Relief: uplift + stream-power erosion (`relief.ts`, `hydrology.ts`)

| Step | Technique | Formula / rule | Function |
|---|---|---|---|
| Coast | Signed distance to `geometry.land` + fractal wobble | land ⇔ sd(p) + A·fbm(p) > 0, A = 35 m; edges on the map frame are not shore | `landMask` |
| Rock uplift | Zones (polyline / disc, cosine falloff, combined by max) × ridged multifractal (Musgrave) on a domain-warped (Quilez), anisotropic point; tapered to 0 near the sea | U = max(bg, zᵢ·½(1+cos πd/r)) · (lo + (hi−lo)·ridged(warp(p))) · smoothstep(0, 900 m, d_sea) | `upliftField` |
| Drainage | Priority-flood routing from the sea (Barnes, Lehman & Mulla 2014), then true D8 among earlier cells | pop order = stack; receiver = steepest neighbour earlier in the stack | `routeFlow` |
| Area | Accumulate upstream to downstream | A[rec] += A[i] over the reversed stack | `accumulate` |
| Incision | Stream power, n = 1, implicit O(n) (Braun & Willett 2013) [memory] | hᵢ ← (hᵢ + dt·Uᵢ + F·h_rec)/(1+F), F = K·dt·Aᵐ/L; m = 0.45 | `erode` |
| Hillslopes | Linear diffusion, explicit | h += c·∇²h, c = 0.12 (stable ≤ 0.25) | `erode` |
| Scale | Land heights scaled so the 99.5 % quantile = 420 m | | `generateRelief` |
| Valley-floor hills | fBm hummocks on flat inland ground, after erosion | h += 120·w_inland·w_flat·max(−0.3, fbm) | `generateRelief` |

Why it works: drainage area concentrates, so valleys branch and ridges sharpen between them. The Cordillera's look comes
out of the erosion, not out of drawn ridges. The divide zones decide which way basins drain: the west divide makes the
Gatún basin drain to the Caribbean, and the east rim closes it so the eastern valleys drain south across the corridor.

## 2. Reservoir: flooding behind a dam (`lake.ts`)

Dam = largest-drainage cell within 1 km of the hint and ≥ 450 m from the sea. Lake = 4-connected cells below level L,
inside the dam's catchment (standing in for saddle dams), reached from the dam. L is found by bisection so the area is
5 km². Fingers are drowned valleys; islands are hummock tops above L. Function: `floodReservoir`.

## 3. Rivers and canal (`water.ts`)

- **Rivers:** channel = A ≥ 0.4 km²; segments run between heads and confluences; width = 5·√(A km²) m, capped at 22
  (hydraulic geometry, Leopold & Maddock 1953) [memory]. `extractRivers`.
- **Canal = cheapest excavation:** A* (16-neighbourhood) with cost/m = 1 + 0.08·(ground − water level)⁺. Legs:
  Caribbean → dam (the Atlantic locks sit at the dam) → across the lake at lake level → Pacific locks → Pacific. The cut
  finds the lowest pass of the divide by itself. `routeCanal`.

## 4. Airport (`airport.ts`)

Compressed like the city: two parallel runways, 1,200 m long (about 1:2.5 of Tocumen's 3,056 m) and 260 m apart, in a
1.3 × 0.36 km grass field. The apron and terminal building sit on the side facing the city, with a parallel taxiway.
(Director, 2026-11-22: the earlier 2 × 1,500 m runways 700 m apart made the field about half the size of the city.
This replaces decision 9's "keep 2 × 1,500 m" for the procedural map.)

The site search covers positions (80 m step, within 900 m of a hint on the plain at the end of the corridor) and
headings 0–50° (5° step; Tocumen's runways are about 29°). Score = height spread inside the field + 0.03·distance +
culvert penalty (share of river cells × 400). Sea, lake and canal are forbidden. The terrain is levelled to the field
mean, and small streams under the field are culverted (no longer drawn there). The terminal sits outside the field, on
the side facing the city. `siteAirport`, `levelAirport`.

## 5. Main roads (`roads.ts`, `paths.ts`)

Slope-cost routing (Galin et al. 2010) [memory]. A* on 8 + knight moves. Cost/m = (1 + k(grade/g0)²) × water factor
(river 25, sea 250, canal 120) × reuse 0.35 on cells already used by the same mode, so routes share trunks. The lake and
the airfield are impassable. Smoothing (Douglas-Peucker + Chaikin) backs off wherever a smoothed point would land on a
blocked cell. `routeRoads`, `smoothAvoiding`.

## 6. Towns (`settlements.ts`)

- **Suitability** S = (1 − smoothstep(0, 0.22, slope)) · (1 − smoothstep(60, 160, h)) · (1 − 0.55·smoothstep(0, 2.5 km, d_sea)).
  Water and the airfield are 0; rivers are 0.15 (crossable, never built).
- **Growth:** one cost-distance per town (Eden-like accretion with a random metric). Step cost = e^{2.2·n}/S, where n
  mixes per-cell hash and fBm, × 0.3^affinity near the town's roads. Towns compete only for ownership, and each stops at
  its target area. El Corredor is seeded along the Interamericana between the city and the airport, and gets its road
  discount only on that stretch (affinity 3), so it grows as a ribbon. `suitability`, `growTowns`.
- Density = 0.35 + 0.65·(1 − √(order of claim)): dense core, sparse edge.

## 7. Metro and railway (`transit.ts`)

Lines are lists of stops (terminals, interchanges, via points), one or more branches per line. Each leg is a least-cost
path preferring built-up ground (metro) or the highway corridor (rail), with a grade penalty, bridges over rivers, rare
canal bridges and very expensive sea crossings. Each leg is smoothed on its own, so stops stay on the track. Stations are
placed at an even spacing (metro 500–650 m, rail 1 km). Stops of different lines within 90 m merge into an interchange.
Lines (director's sketch, 2026-11-22): Línea 1 (Casco tip → Casco → north hub), Línea 2 (Balboa → Casco → bay east; and
north hub → El Corredor → airport), Línea 3 (Casco → west junction → north hub, with a spur north), Ferrocarril
Interoceánico (north hub → Colón).

## 8. Land cover and render (`cover.ts`, `render.ts`)

- **Cover:** mangrove (low, near large river mouths), clearings (fBm + lowland bonus + town-fringe bonus > threshold),
  high forest (h > 230 m or slope > 0.4), forest elsewhere, paved airfield.
- **Render:** multidirectional hillshade (Mark 1992, key light NW plus three fills) on a height upsampled to 5 m with fine
  fBm detail. Valleys are darkened by h − blur(h), a sky-view proxy. Sea colour comes from depth. The lake edge comes
  from a blurred mask, and the beach is a pixel-level fringe from the shore distance. Towns get neighbourhood street grids
  with their own orientation per ~450 m cell. PNG encoding uses node:zlib (no dependency).

## Guards (`tests/proc-isthmus.test.ts`, each mutation-checked)

| Guard | Mutation that turned it red |
|---|---|
| Routing: receiver before donor; all area reaches the sea | receivers allowed uphill / later in the stack |
| Reservoir: below level, connected to the dam, 5 km², dam on a main river | flood admits cells up to L + 8 m |
| Canal water connects both seas | Pacific leg dropped |
| Roads / tracks avoid the lake and the airfield | lake cost made finite |
| Towns on dry land, within targets, El Corredor ≥ 1 km² | water no longer vetoes suitability |
| Stations on their tracks; ≥ 2 interchanges, railway meets the metro | stops never merge |
| Determinism (coarse grid) | `Math.random` in the growth jitter |

## Sources

- Barnes, Lehman & Mulla 2014, priority-flood, <https://arxiv.org/abs/1511.04463> (opened).
- Braun & Willett 2013, Geomorphology 180–181 (implicit stream power) [memory; publisher page blocked].
- Musgrave, ridged multifractal (Texturing & Modeling); Quilez, domain warping [memory].
- Galin et al. 2010, Procedural Generation of Roads [memory].
- Leopold & Maddock 1953, hydraulic geometry [memory].
- Mark 1992, multidirectional oblique-weighted hillshade [memory].
- Batty & Longley 1994, Fractal Cities (Eden / DLA growth) [memory].
