# 01 — San Andreas techniques for perceived size

Techniques only. No SA map, layout, names or assets are reused (CLAUDE.md: original content).
Status: investigation, not a spec decision. The director decides what moves into `specs/`.

Evidence grades: **[V]** verified in 2+ sources or primary data; **[S]** single secondary source;
**[U]** unverified or my inference. Web research was thin on primary developer material (GDC talks
on SA scale were not found), so most "why it works" rows rest on perception literature plus
community analysis, and every band in section 4 is **a proposal to calibrate, not a measured SA
value**. Nobody has published SA route-tortuosity or sightline numbers that I could find.

## TL;DR

1. SA is small: about 36 km² (6 x 6 km), ~38 km² with the sea margin. TRÁNSITO (6 x 8 = 48 km²) is
   already ~25-30% larger in area. The "size" of SA is mostly perception, so the gap is technique, not km².
2. The cities are tiny (each roughly one Vice City, ~9 km² or less) but are separated by roughly half the
   land in countryside, mountains, desert and water. Separation, not city size, creates "far".
3. Rockstar used the PS2 fog and short draw distance as a design tool: hills and fog hide the rest of the world.
4. Gating (closed bridges, wanted level outside the start region) makes the world grow over time.
5. Highways run long and loop around, so cross-map trips are minutes of travel with scenery change.
6. Density gradient (city > suburb > farm > wilderness) plus biome contrast makes each leg feel like a trip.
7. Known failures: empty countryside, "sketch-like" cities (Rockstar's own words). Mitigate with points of interest per km².
8. Plan: measure separators, route tortuosity, occlusion and travel time with computed metrics (section 4).

## 1. Hard numbers

| Item | Value | Grade | Source |
|---|---|---|---|
| SA area (headline) | 36 km² (13.9 mi²) | V | [StrategyWiki](https://strategywiki.org/wiki/Grand_Theft_Auto:_San_Andreas/San_Andreas), [gta.wiki](https://gta.wiki/w/State_of_San_Andreas_(3D_Universe)) says ~33 km² |
| SA area, community calc incl. water | 38.2 km² total = 31.55 land + 6.67 water (~83% / 17%, my arithmetic) | S | KeWiS figures as relayed by [Sportskeeda](https://www.sportskeeda.com/gta/gta-series-the-map-size-every-mainline-game-series) |
| SA side length | ~6 x 6 km (square map, coordinates +-3000 units, 1 unit ~ 1 m) | U (consistent with 36 km², not directly cited) | inference |
| Countryside share | "about 50 percent of San Andreas' entire landmass" (2004 preview) | S | [GameSpot preview](https://www.gamespot.com/ps2/action/gta4/preview_6106693.html) (via search snippet; page itself returned 403) |
| Cities | 3; LS largest by area, LV second, SF smallest by area but 2nd by population | V | [gta.wiki](https://gta.wiki/w/State_of_San_Andreas_(3D_Universe)) |
| Per-city area | Not found. Pre-release claim: each city "roughly the size of all Vice City" (~9 km²) | S | [GamesRadar](https://www.gamesradar.com/gta-san-andreas-factsplosion) via snippet; likely upper bound |
| Highest point | Mount Chiliad ~526 m | S | [gta.wiki](https://gta.wiki/w/State_of_San_Andreas_(3D_Universe)) |
| Counties | 5 non-city regions (Red, Flint, Whetstone, Bone, Tierra Robada) | V | gta.wiki |
| Scale vs reality | SA compresses a US state (hundreds of km) into 6 km; ratio on the order of 1:50-1:100. | U | inference; one AI-written page claims 1:100, not relied on |
| Fastest car | Infernus 240 km/h (149 mph) from game data | S | [GTABase](https://www.gtabase.com/gta-san-andreas/vehicles/infernus) |
| Cross-map time | LS to LV ~10 min "at highway speeds" (low-quality source); LV east to SF west 45+ min (low quality) | U | [StudyRaid](https://app.studyraid.com/en/read/97460/4389843/mapping-out-los-santos-san-fierro-and-las-venturas), do not cite as fact |
| Computed cross-map time | 6 km edge: at 60 km/h = 6.0 min; 100 km/h = 3.6 min; 150 km/h = 2.4 min (straight line, so real roads add 20-60%) | V (arithmetic) | this doc |
| Draw distance | SA draw distance ~4x Vice City's (preview claim); PC build renders objects ~2-4x farther than PS2. No exact PS2 fog/LOD values found | S | [GameSpot preview](https://www.gamespot.com/ps2/action/gta4/preview_6106693.html), community summaries |
| Fog role | Fog hid most of the world and let PS2 render less, and Rockstar designed the map and cities around it. Remaster that pushed draw distance back made the map "feel tiny" per players | S | [Kotaku](https://kotaku.com/gta-trilogys-san-andreas-now-feels-depressing-without-i-1848047292) via snippet, [GamesRadar](https://www.gamesradar.com/gta-trilogy-san-andreas-fog-controversy) via snippet |
| Memory constraint | World was originally three separate maps because PS2 memory was "very tight"; later joined | S | [GamesRadar](https://www.gamesradar.com/games/grand-theft-auto/on-its-20th-anniversary-gta-san-andreas-veteran-shares-the-open-world-was-originally-split-into-three-maps-memory-was-very-tight-on-the-ps2) (headline/quote only) |

Series comparison (total area incl. water, community calc, [Sportskeeda](https://www.sportskeeda.com/gta/gta-series-the-map-size-every-mainline-game-series)):

| Game | km² | x TRÁNSITO (48) | Note |
|---|---|---|---|
| GTA III | 8.1 | 0.17 | three islands joined by closed-then-opened bridges |
| Vice City | 9.1 | 0.19 | two islands |
| GTA IV | 16.1 | 0.34 | one city, dense |
| San Andreas | 38.2 | 0.80 | three cities + 50% countryside |
| GTA V | 75.8 (land 48.2) | 1.6 (1.0 land) | one city plus a large rural north |
| TRÁNSITO | 48 (land share TBD) | 1.0 | Act 1 corridor ~8 km² |

Takeaways: [V] our land area is at or above SA's; [S] players "remember SA as bigger than it was"
([Kotaku](https://kotaku.com/gta-vs-san-andreas-vs-2004s-san-andreas-1680497698)); [S] it "feels larger than GTA V, which is more than twice
its size" ([PC Games DE](https://www.pcgames.de/Grand-Theft-Auto-San-Andreas-Spiel-56275/Specials/retro-rueckschau-open-world-rockstar-games-1554292/), German).
So perceived size is not a function of km².

## 2. Perceived-size techniques

Common frame for "why it works": people estimate distance from travel time, number of distinct
places passed and how long the destination stays out of sight, not from metres. Lynch's five
elements of the mental map (paths, edges, districts, nodes, landmarks;
[Image of the City](https://en.wikipedia.org/wiki/The_Image_of_the_City)) are the vocabulary used here. Game use: [Upton, GDC 2007](https://gamedeveloper.com/game-platforms/post-gdc-i-rainbow-six-i-s-upton-talks-landscaping-game-worlds);
an early empirical test found only some of Lynch's categories show up in player maps
([Wellesley study](https://cs.wellesley.edu/~pmwh/mvmap/papers/open_world_elements/open_world_elements.html)), so treat the model as a design aid, not law.

| # | Technique | How SA uses it | Why it works | Measurable proxy on our map |
|---|---|---|---|---|
| 1 | Separation by countryside, water, mountains | Three cities sit apart; roughly half the land is rural/desert/hill [S]. Each leg crosses a different biome | Travel time and "changing scenery" read as distance; edges (Lynch) make districts feel like places | Gap width between town polygons (m, edge to edge); share of land that is non-built; count of biome changes along city-to-city route |
| 2 | Rivers and bays with few bridges | Bridges (Gant-type spans, gated crossings) are the only links between landmasses [V for existence, grade S for effect] | Chokepoints lengthen routes and create a shared, memorable path (node) | Bridge count per river; mean detour ratio for trips that cross a river vs straight line; max distance between crossings |
| 3 | Winding mountain roads | Mountain roads (including short tunnels on the SF highway [V]) bend and climb between regions | A road that turns hides its end and takes longer than the straight line | Route tortuosity = route length / straight-line length, per city pair and per road class |
| 4 | Elevation and occlusion | Hills and mountains hide the next region; vistas only from high ground. "From high vantage points players grasped how small it is" ([PC Games DE](https://www.pcgames.de/Grand-Theft-Auto-San-Andreas-Spiel-56275/Specials/retro-rueckschau-open-world-rockstar-games-1554292/)) [S] | You never see the whole map, so you cannot measure it. Reveal is rationed | Viewshed area from ground-level points on main roads (% of map visible); fraction of ground-level routes with no sightline to the next town; hilltop viewshed reserved as a reward |
| 5 | Fog / draw distance / LOD | PS2 fog and short view distance hid the world; map designed around it [S]. Remaster with long draw distance feels small [S] | Atmospheric perspective gives depth cues; limited range caps how much "map" is on screen | Fog far distance as % of map width; ratio fog_far / typical town width; LOD ring radii |
| 6 | Density gradient urban to wilderness | Dense core, suburbs, farms, desert with sparse buildings, traffic and peds; GTA density is "more about things per area than total size" ([TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Main/SlidingScaleOfVideoGameWorldSizeAndScale), weak source) | Contrast between zones makes each leg a trip and each town a destination | Building coverage % per ring (core / inner / outer / rural); road density km/km²; POI per km² per zone; step ratio between zones |
| 7 | Landmarks and distant silhouettes | Chiliad is the tallest peak and a visible orientation anchor [S]; city skylines are visible from outside | A landmark seen far away and reached later converts a dead stretch into progress; supports orientation | Landmark visibility: number of distinct landmarks visible from a road point (target 1-3); first-visible distance; % of road km with a landmark in view |
| 8 | Region unlocking | Start confined to the first city; bridges give an instant wanted level; SF and countryside open first, LV last [S: [GTAIntel](https://gtaintel.com/news/san-andreas-map-explained)]. Rationale is a fan interpretation [U] | The playable world is small at first and grows 2-3x; the map "keeps expanding" | Playable area per act (km²); growth factor per unlock; closed-crossing count |
| 9 | Diagonal / curved, non-grid layouts | SA uses freeways, bypasses, diagonals and varied town layouts [S: [gta.wiki highways](https://gta.wiki/w/San_Andreas_Highway_System)] | Grids are legible and read as a small repeated unit; irregular nets hide extent and lengthen routes | Orientation entropy of road bearings (higher = less grid); mean block regularity; ratio of grid-aligned edges |
| 10 | Varied biomes compressed together | Desert, forest, farmland, city, mountain, coast within 6 km | Each biome is a "place"; more distinct places passed = longer remembered trip | Count of distinct biome classes; biome patch count per route; mean patch length per 5 km of route |
| 11 | Vertical play | Chiliad (~526 m, which is ~9% of the 6 km width [arithmetic]), rooftops, ramps, tunnels | Z-axis adds explorable space without adding area | Relief range (m) / map width; share of land above slope threshold; count of climbable high points |
| 12 | Interiors and side areas | Interiors, secret locations, an airstrip, bases, side areas off the road [S] | More to discover per km² raises "content size" | POI per km² (inc. dead-end side areas); number of off-road destinations |
| 13 | Highway rings and long freeways | Loop highway, bypass around LS, beltway around LV, one long freeway connecting regions [V: [gta.wiki](https://gta.wiki/w/San_Andreas_Highway_System)] | A fast road gives a long uninterrupted leg and lets speed reveal distance; rings give orientation | Freeway km; ring circumference; time for a full loop at design speed; exits per km |
| 14 | In-game map projection | Full-map overview is a plain top-down image with cities as small patches (inference from how players compare it). Radar zoom is local, so only a small window is ever visible | The radar shows a few hundred metres, never the whole; the full-map UI is the only time size is judged | Radar window / map width; fraction of the map revealed on discovery |
| 15 | Vehicle speed tuned to map size | Top speeds of 150-240 km/h exist, but roads, curves and traffic cap typical speed far lower; airplanes and trains exist for fast travel [S] | If top speed is easy to reach on a straight, a 6 km edge is crossed in 2-3 min and "feels small" | Typical cruise speed on each road class; cross-map minutes; ratio travel time to straight-line distance |
| 16 | Ambient population and traffic | Traffic and peds scale with zone density and time of day | Inhabited space reads as bigger and "real"; empty space reads as filler | Vehicles and peds per km of road per zone; ratio city : rural; variance over time of day |
| 17 | Streaming and hidden loading | Rockstar originally had three separate maps due to PS2 memory limits, then joined [S: GamesRadar] | Seamless travel means the whole world is felt as one place | Streaming ring radius vs. fog far; time of first pop-in |

## 3. Criticisms and what later games changed

| Issue | Evidence | What later games did |
|---|---|---|
| Empty countryside, "nothing but barren lands" | Critics quoted in search results (e.g. [GamesRadar fan piece](https://gamesradar.com/games/grand-theft-auto/gta-6-map-should-be-more-like-san-andreas) argues the opposite: countryside is the best part) [S, mixed] | GTA V keeps a rural north but adds activities, wildlife, vistas; GTA IV drops rural entirely for a dense single city |
| Cities too small / "sketch-like" | Rockstar on GTA V: they wanted "a proper Los Angeles" because SA's cities were "very small, sketchlike" (via [GTA V setting](https://www.thegtaplace.com/gtav/setting), original source not verified) [S] | One large dense city (IV, V) |
| Long drives | Sam Houser: "if you don't like driving over that distance, the point of the game is don't go there" ([GamesRadar](https://gamesradar.com/sam-houser-gta-iv-crazier-than-ever/3)) [S] | Fast travel, taxis, planes, more vehicle types |
| World reads as small when you can see it all | Draw distance in remaster removed fog and map felt tiny [S] | Games ship long view distance but add haze, depth-of-field, terrain occlusion |
| Memory-forced split | Three maps joined later [S] | Streaming on later hardware |
| Same-ness / "more of the same" | 2004 blog post cited in [Grand Text Auto](https://grandtextauto.soe.ucsc.edu/?p=566) [S] | Varied missions per region, unlock pacing |

Implication for us: separators must be backed by content (POIs, traffic, readable change of biome),
otherwise the gap is empty time. Budget a minimum POI density even in "empty" bands.

## 4. Technique to TRÁNSITO

Real Panama features below are suggestions for the director, drawn from general geography and
my own knowledge. Verify each against the geo engine (`npm run geo`) before use.
Act 1 corridor today: ~8 km² (rect x 4000-6000, y 0-4000). Target bands are proposals to
calibrate after running a baseline on SA-like maps we can build, not measured SA values.

| Technique | Panama feature that could play the role | Proposed metric | Target band (proposal) |
|---|---|---|---|
| 1 Separation | Town clusters split by rivers, mangrove and hills; Tocumen/Juan Diaz as an eastern cluster, San Miguelito as another, city as third | Mean edge-to-edge gap between town polygons; non-built land share | gap 400-1200 m between neighbouring towns; non-built land >= 45% of land |
| 2 Rivers / few bridges | Río Juan Díaz, Río Tapia, Río Tocumen; canal and its bridges as the master chokepoint | Bridges per river crossing corridor; detour ratio across rivers | 1 crossing per 1.5-3 km of river; detour ratio across river 1.3-2.0 |
| 3 Winding roads | Roads over San Miguelito hills; Cerro Azul / Chagres foothill roads | Route tortuosity (route / straight) | city-to-city 1.25-1.6; hill roads 1.5-2.2; flat grid <= 1.2 |
| 4 Elevation / occlusion | San Miguelito hills as occluding high ground between the core and the east | Ground-level viewshed % of map from main road points; next-town sightline blocked share | mean viewshed <= 15% of map; >= 60% of inter-town trips lose sight of origin before arrival |
| 5 Fog / LOD | Humid haze over the bay and hills, tropical atmospheric perspective | Fog far / map width; LOD ring radii | fog far 800-1500 m (13-25% of the 6 km width, SA-like feel, tune on dev build) |
| 6 Density gradient | Core to San Miguelito to periphery to mangrove/forest | Building coverage per ring; road density per ring | core 35-50%, suburban 15-30%, rural 2-8%, wild <1%; step >= 1.5x between rings |
| 7 Landmarks | Cerro Azul / Chagres range as distant big mountain silhouette; towers, canal infrastructure, airport tower | Landmarks visible per road point; first-visible distance | 1-3 visible from 70% of road km; mountain visible from >= 80% of open-ground points |
| 8 Region unlock | Canal bridges and river crossings closed by a barrier until the story opens them; Act 1 confined to the corridor | Playable area per act; growth factor | Act 1 ~8 km² to Act 2 ~16-20 km² to full 48 (x2-2.5 steps); director's call on gating form |
| 9 Non-grid roads | Diagonal arteries, Corredor Sur / Norte, spontaneous barrio streets (La Carpio seed already in flight) | Bearing entropy; share of grid-aligned edges | grid-aligned edges <= 40% outside planned districts; high-entropy bearings in barrios |
| 10 Biomes | Mangrove (Juan Díaz coast), rainforest slopes, urban, bay, airport apron, savanna-like clearings | Biome class count; patches per route | >= 5 biomes in 48 km²; >= 3 biome changes on the longest route |
| 11 Vertical | Hills, overpasses, roofs; Cerro Azul as the big mountain; relief seed in `terrain.ts` | Relief range / map width | relief range >= 8-10% of 6 km width (~500-600 m for the big mountain, local hills 60-150 m) |
| 12 Side areas | Interiors (shops, clinics), barrio alleys, port and airport edges | POI per km² incl. dead-end side areas | >= 6 POI/km² urban, 1.5-3/km² rural |
| 13 Highway rings | Corredor Sur / Norte as elevated highways; a ring or bypass | Freeway km; loop time | one 6-8 km freeway; 2-3 min at design speed; exits every 1.5-2.5 km |
| 14 Map projection | In-game map shows only discovered areas, radar local | Radar window / map width | radar <= 5% of map width; reveal map by discovery |
| 15 Speed tuning | Motorbike (Tito's vehicle) and car classes | Cross-map minutes; cruise speed per road class | cross-map (6-8 km route length) 6-10 min at typical speed, 3-4 min top speed; urban cruise 40-60 km/h, highway 90-110 km/h |
| 16 Ambient density | Traffic jams on arteries, rural near-empty roads | Vehicles per road km per ring | core 10-25 veh/km, suburban 4-10, rural 0.5-2 |
| 17 Streaming | Chunks around the player | Stream radius vs fog far | stream radius >= 1.2 x fog far |

Numbers with the strongest logic (computable now): travel time, tortuosity, bridge count,
non-built share, viewshed. Weakest: ambient density and POI bands, which need playtest.

## 5. Open questions for the director

- How much of the 48 km² should be deliberate "empty" separator vs. built? SA ~50% countryside is the only data point.
- Is gating by closed crossings (technique 8) acceptable story-wise for Act 1, or is a soft barrier (heat, rep) preferred?
- Should the fastest vehicle be capped so a 6 km edge costs >= 3 min?
- Do we want a hard fog (tool, as SA) or a soft haze that still lets the big mountain show?

## Gaps in this research

- No primary SA developer talk on scale found; "fog designed into the map" comes from journalism.
- No exact PS2 draw distance or fog values; no verified per-region areas; cross-map times unverified.
- Several fetches (GameSpot 403, GamesRadar/Kotaku/PC Gamer truncated) were read through search snippets only.
- Real Panama positions not checked against data in this pass.
