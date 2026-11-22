# 01 — How Rockstar approximated real places

Extends [`san-andreas-techniques.md`](san-andreas-techniques.md) (area, 17 techniques, fog, gating); not repeated here.
Techniques only: nothing of GTA's map, names or layout is reused (CLAUDE.md "Contenido original").

## Evidence quality (read first)

Primary developer material on road simplification, district distances or road density **does not exist publicly** as far
as I could reach in this pass. What exists: art-director interview snippets, journalism, and fan overlay projects.
Grades: **[D]** developer statement, **[J]** journalism relaying developers, **[F]** fan analysis / speculation,
**[M]** my measurement or arithmetic. No claim below is a measured Rockstar value unless graded [D].

## What the sources say

| Claim | Grade | Source |
|---|---|---|
| GTA V pre-production = "a lot of Googling and StreetView scoping" plus team trips; film crews scouted, photographers shot sites using StreetView coordinates | D | Aaron Garbut (art director) in MCV, <https://mcvuk.com/?p=80936> (fetched) |
| Cities are treated "like a sculpture"; the team checks that perspectives down streets look right | D | same |
| Compression is in atmosphere, not just distance: a neighbourhood character shift that would span "ten miles" happens within a few blocks | D (paraphrase of Garbut) | same |
| Design is fun-first: place many interesting locations, then build missions around them | D | same |
| Los Santos is a compressed Los Angeles; Blaine County blends nearby California counties (Ventura / Santa Barbara feel; San Bernardino influence at the north and south ends) | F/J | fan wikis via search: <https://wiki.gtaboom.com/wiki/How_Well_Does_GTA_V%27s_Map_Emulate_Los_Angeles>, <https://wiki.sportskeeda.com/gta/blaine-county-in-gta5> (not fetched; snippets only) |
| Explicit ratios "land 29 sq mi vs 4,700 sq mi = 1:160; road network 124 mi vs 19,000 mi = 1:150" | F, unverified sourcing | <https://expertbeacon.com/how-accurate-is-gta-map-to-la/> (snippet). Do not rely on it: SEO page, comparing a city to a county. |
| Neighbourhood analogues (Rockford Hills ~ Beverly Hills, Vespucci ~ Venice) | F | gtaboom wiki snippet; no distances published |
| San Andreas: 6 x 6 km (up from 4 x 4 in III / VC); originally three separate maps, joined into one with countryside and desert between cities | J (Obbe Vermeij, Rolling Stone, GamesRadar) | <https://rollingstone.com/culture/rs-gaming/grand-theft-auto-san-andreas-20-year-retrospective-1235143587>, <https://gamesradar.com/games/grand-theft-auto/on-its-20th-anniversary-gta-san-andreas-veteran-shares-the-open-world-was-originally-split-into-three-maps-memory-was-very-tight-on-the-ps2> (snippets) |
| Vice City: "based fairly closely on real Miami, but not so closely that gameplay suffered" | D | Vice City level-design Q&A, <https://www.gamespot.com/ps2/adventure/gta_vc/preview_2885365.html> (snippet) |
| The SA cities were "very small, sketchlike"; V wanted "a proper Los Angeles" | J, original unverified | already in `san-andreas-techniques.md` section 3 |

Not reachable / not found: GDC talks on Los Santos scale; the TechRadar "how Rockstar created GTA 5" page (truncated by the
fetch); GameSpot SA preview (403 earlier); any Rockstar statement on freeway simplification.

## What was kept, what was compressed (synthesis)

| Aspect | Pattern seen | Grade | Use for TRÁNSITO |
|---|---|---|---|
| Landmark adjacency | Recognisable pairs stay adjacent in the right order and on the right side of water/hill (beach next to pier next to canals; downtown inland of the beach) even when the real gap is km | F | Keep **order and side** (Casco, Cinta Costera, Paitilla, Panama Viejo, Costa del Este along the bay); scale each gap independently |
| Coast shape | Coast is simplified but its signature bends survive (bay, point, pier) | F | Already our rule: `geometry.land` stays; each anchor sits on a signature bend |
| Freeway topology | Freeways keep **connectivity** (which hubs they join, ring/spur shape) and are smoothed and shortened; interchange count drops | F | Keep who-joins-whom (bridge to city to east past Tocumen; Colón link); reduce interchange count; test topology, not geometry |
| District-to-district distance | Not published. Shift of character within blocks (Garbut) implies non-linear: dense cores keep real block scale, gaps between them shrink most | D (principle) / none (numbers) | Per-zone ratios as in `specs/map/README.md` (1:3 city, 1:4 corridor, 1:10 canal/lake). Do not copy any GTA ratio |
| Road density vs real | No published figure. Streets themselves (width, block size) stay near real scale; compression is by **dropping fabric and skipping districts** | J/F | Matches skill rule 1 ("compress by dropping fabric, never shrinking blocks") |
| Rural/mountain content | Reduced to a few readable roads plus points of interest | F | Layers 1 to 5 over the whole isthmus: few main roads, POI floor (see `san-andreas-techniques.md`) |

## Consequence for the plan

1. Real places feed **order, topology, and numbers**. Whether they also feed **reference geometry** is the director's question;
   Rockstar's practice (photo/StreetView research, then authored simplification) is closest to "authored routes, real
   references used to check and to sketch" (alternative C in `../02-alternatives/`), not to warping data into the game.
2. The cheap, defensible test is topological: same hubs joined, same left/right and water-side order, same count of crossings
   of the canal. These can be computed on any candidate map (see `../03-technical/06-main-roads.md`).
3. Gap: nobody publishes Rockstar's distances or densities. Any band that claims to be "GTA-like" would be invented.
   Bands in this plan come from Panama measurements instead.
