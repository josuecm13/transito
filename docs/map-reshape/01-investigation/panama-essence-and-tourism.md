# 01 — Panama City essence, tourist catalogue, vibe rules

Extends `panama-city-signature-places.md` (call it SIG) and `real-geography.md`. Places already there are **referenced by id,
not repeated**: `old-quarter`, `coastal-avenue`/Cinta Costera, `arch-bridge`, `cable-bridge`, `pacific-locks`, `atlantic-locks`,
`albrook`, `gamboa`, `free-zone`, `container-port`, `costa-del-este`/`gated-community`, `passenger-terminal`, Ancón Hill, Metropolitano,
Mercado de Mariscos, Biomuseo, Amador causeway, Panamá Viejo, Corredor Sur. Real places are inspiration only (CLAUDE.md "Contenido
original"): working names below are original; private brands are never used.

Position grades: **[OSM]** = Nominatim (OpenStreetMap) lookup in this pass, returned a node/way centre (2026-11-25);
**[web]** = WebSearch result (descriptive only, no coordinates); **[mem]** = my memory, unverified, +-300 m to +-3 km.
Scale (footprint m, height m) is **[mem]** everywhere unless stated: no survey data was read. Casco reference (8.9525, -79.5347).
Offsets: dE = dlon x 109.7 km/deg, dN = dlat x 111.1 km/deg (lat 9 N).

## A. Essence: what a player should feel

Ranked by what a top-down / 3rd-person camera can actually show. Sensory and cultural items are [mem] / general knowledge, not
verified in this pass.

| # | Feel | Concrete ingredients the game can show or play | District id |
|---|---|---|---|
| 1 | **Three cities in one view**: colonial pastel, glass towers, tenement hill, within 3 km | Casco 1-3 storey ochre/pink/teal blocks with wooden balconies, bell towers, plazas; behind the bay a wall of 150-250 m towers; El Chorrillo / Calidonia walk-ups 4-6 storeys with laundry and hand-painted signs; San Miguelito stacked concrete on hillsides. The **contrast across one street** is the signature: a ruined balconied shell next to a restored boutique hotel | `city-core`, `tito-corridor` |
| 2 | **Heat, rain, steam** | Wet-season afternoon downpours (short, violent, then sun); wet asphalt shine, puddles at kerbs, storm drains overflowing, steam off roofs; constant 30 C+ haze; ribbed corrugated-zinc roofs that drum; awnings and covered sidewalks (arcades) as shelter | all land |
| 3 | **Ships on the horizon** | From the bayfront, 20-30 ships wait anchored in the bay for the canal; container cranes at Balboa; a Panamax passing a street end at Miraflores / Gamboa. Ships are skyline furniture, not events | `sea`, `pacific-locks`, `canal-central` |
| 4 | **Diablos rojos** | Repainted US school buses: airbrushed murals, chrome, neon, stripes, loud reggaeton. Replaced by Metrobus but still the colour of the corridor. Mobile billboards that stop anywhere, honk, swerve; bus stops are crowd nodes | `tito-corridor`, `city-core` |
| 5 | **Bay as the front yard** | Cinta Costera: joggers, vendors, kites, food carts, benches, sodium-lit evening; fish market with shouting vendors and ceviche cups; fishermen's boats and pelicans at the Casco sea wall; sunset over the bay, skyline in silhouette | `city-core` strip (SIG) |
| 6 | **Jungle at the edge** | Forest is always 5-10 min away: Ancón Hill, Metropolitano, Gamboa; vines on abandoned concrete (Zonian relics), howler monkeys, vultures circling, toucans; the road simply stops at green. Rain forest is a wall behind the last houses | `jungle-ridge`, `canal-central` |
| 7 | **Metro and traffic** | Elevated Line 2 viaduct on columns over the corridor; Line 1 along the Transístmica; gridlock on one-way streets, tranques at 17:00, horns, taxis cruising at a crawl, Corredor Sur as the fast lane over the bay | `city-core`, `tito-corridor` |
| 8 | **Festival colour** | Carnaval (floats, water trucks "culecos", queens), pollera (white lace dress, gold tembleques in the hair), mola (appliqué textile, Guna), Christmas lights on every pole in December, Panamanian flags everywhere in November. Dressable: bunting, mola-pattern awnings, Guna vendors | `city-core` (Casco), `colon` |
| 9 | **Food and markets** | Fonda (cheap lunch counter), fried cart snacks (hojaldras, carimañolas, empanadas), sancocho, ceviche cups at the market, fresh coconut water, chicheme, fruit stalls at the roadside; metal tables, plastic stools, hand-written menus | `city-core`, `tito-corridor`, `colon` |
| 10 | **Colón: decay beside a fortress of trade** | Colón core: 1900s wooden/concrete tenements with long balconies, rubble lots, cracked stairs, residents on the balcony; ten minutes away, the Free Zone: walled grid of showrooms, guarded gates, container trucks, perfect asphalt. **Same city, two economies** (SIG `free-zone`, `neto-building`) | `colon` |
| 11 | **Bilingual traces** | English/Spanish signs, Zonian-era wooden houses with screened porches on stilts, Afro-Antillean churches and corrugated-iron balcony houses, US-built bridges and barracks reused. Canal Zone architecture = broad lawns, white clapboard, red roofs | `pacific-locks`, `canal-central`, `colon` |
| 12 | **Reclaimed land and gated towers** | Costa del Este: wide empty boulevards, mirrored towers, security booths, malls; towers rise on bare fill with palms in rows and no street life (the opposite of Casco) | `costa-del-este` |

## B. Catalogue of tourist and recognisable places NOT in SIG / world.yaml

Compression rules used (each derived from the existing spec, then applied mechanically; I ran a point-in-polygon test of every
proposed point against `geometry.land`, 37 vertices, in a local script, nothing in the repo was touched):

| Rule | Where | Formula (x east, y north, metres) | Basis |
|---|---|---|---|
| **R1 Casco local** | within about 1.2 km real of Casco | x = 2400 + dE/2, y = 400 + dN/2 | `old-quarter` (2400,400) is Casco; 1:2 so the peninsula stays readable. Tip land point is (2350,100) |
| **R2 bayfront chain** | Casco to Punta Pacífica shoreline | x = 2400 + dE/2, y = 400 + dN/4 | reproduces SIG's Paitilla (+2.2 E, +2.5 N) -> (3500,1020) |
| **R3 Ancón-relative** | Ancón slope | offset from Ancón Hill proposal (1900,950) at 1:3 | SIG proposes Ancón (1900,950) |
| **R4 canal-central** | Gamboa / Soberanía | offset from `gamboa` (1400,3600) at 1:10 | `canal-central` compression 10. Real Gamboa taken as [mem] 9.120, -79.699 |
| **R5 off-edge hints** | beyond or at the playable boundary | pinned to the nearest map edge, skirt terrain / horizon sprite only | CLAUDE.md rule 5 (rest of isthmus = grey blocks) |

**Worked conversion (R1, Plaza de Francia).** OSM 8.9498574, -79.5320797. dE = (-79.5320797 + 79.5347) x 109,700 = +287 m;
dN = (8.9498574 - 8.9525) x 111,100 = -293 m. x = 2400 + 287/2 = **2544**; y = 400 + (-293)/2 = **254**. Check: shore at x=2544 is
about y=178 (edge (2350,100)-(2600,200)), so 254 is on land, 76 m inland, a tip-of-peninsula sea wall as in reality.
**Second (R2, F&F tower).** OSM 8.982863, -79.518399: dE = +1,788 m, dN = +3,373 m -> x = 2400 + 894 = **3294**, y = 400 + 843 = **1243**
(on land; shore at x=3294 is about y=930).

Offsets below are E / N in km from Casco, rounded. Audience: **T** = tourist-facing, **L** = locals' place, **TL** = both.
`engine fragment?` follows the coordinator addendum (800 m squares, <= 2 km2, registry `specs/map/fragments/index.yaml`; existing slugs:
la-carpio, juan-diaz, las-mananitas, pedregal, samaria, tocumen, torrijos-carter). I did not run the engine.

### B1. Casco Viejo block and the city

| id / working name | Real lat, lon (grade); offset | Recognisable top-down / 3rd-person | Scale footprint m x height m; kind | Verdict | District, proposed (x,y) | Aud. | engine fragment? | what to measure |
|---|---|---|---|---|---|---|---|---|
| **P1 `plaza-de-la-punta`** (Plaza de Francia + Las Bóvedas; OSM has them as one object "Plaza de Francia - Las Bovedas") | 8.9497, -79.5320 [OSM]; +0.29 E, -0.29 N | Wedge plaza at the very tip of the peninsula; stone sea wall with arched vaults along the water; obelisk and a row of monuments; sea on 3 sides | plaza about 80 x 60, wall about 150 long, 6-10 high; historic | **ANCHOR** | city-core (2544, 254) | T | **yes `casco-viejo`**, centre 8.9520, -79.5340 (covers P1-P5), size_m 800 | street grid and block fill, building heights, POIs (plazas, churches) |
| **P2 `plaza-mayor-catedral`** (Plaza Catedral, cathedral twin towers, Museo del Canal on the same plaza) | Museo del Canal 8.95179, -79.53467 [OSM] (plaza proxy; cathedral itself not returned by Nominatim, [mem] on the same plaza); about 0 E, -0.08 N | Square plaza with a church of two white bell towers (the only towers inside Casco) and arcaded facades; the **centre** of the grid | plaza about 90 x 90, cathedral about 50 x 35 x 35 (twin towers); historic | **ANCHOR** | city-core (2402, 360) | TL | covered by `casco-viejo` | as P1; building heights |
| **P3 `teatro-del-istmo`** (Teatro Nacional) | 8.95285, -79.53310 [OSM]; +0.18 E, +0.04 N | Small cream-and-gold opera-house block with a painted dome, hemmed in by a street grid | about 40 x 30 x 20; civic | FILL | city-core (2488, 420) | T | covered by `casco-viejo` | building heights, footprint outline |
| **P4 `iglesia-del-altar-dorado`** (San José, "Altar de Oro") | 8.95139, -79.53601 [OSM] (Iglesia de San José); -0.14 E, -0.12 N. Name-to-church match is [web]-consistent (the gilded altar is the church's draw) but not confirmed by a source | Plain pale facade; the gold is interior only, so **nothing distinctive top-down** | about 30 x 20 x 20; historic | FILL | city-core (2328, 338) | T | covered | POIs |
| **P5 `plaza-bolivar-casco`** | 8.95329, -79.53353 [OSM]; +0.13 E, +0.09 N | Small tree-shaded plaza with a statue and a church | about 60 x 60; civic | FILL | city-core (2464, 444) | TL | covered | POIs |
| **P6 `casa-de-las-garzas`** (Palacio de las Garzas, presidential, herons in the courtyard) | [mem] about 8.955, -79.534, north tip of Casco; about +0.2 E, +0.3 N | Heavily guarded white palace block at the north neck of the peninsula; police checkpoints | about 80 x 60 x 15; civic | FILL | city-core about (2500, 550) (R1) | T | covered | footprint |
| **P7 `mi-pueblito`** (themed folk village on the Ancón slope) | 8.95331, -79.54796 [OSM]; -1.46 E, +0.09 N. (relative to Ancón peak: +0.14 E, -0.48 N) | Cluster of small coloured huts and a chapel on a hill terrace, road above it | about 100 x 80 x 6; historic (replica) | FILL | city-core (1945, 790) (R3) | T | no (single site, replica) | n/a |
| **P8 `torre-helice`** (F&F Tower, Frank Gehry-style twisted tower; working name avoids brand) | 8.98286, -79.51840 [OSM]; +1.79 E, +3.37 N | **Twisted, rippled glass slab**, the only non-rectangular tower on the skyline; sits behind the Cinta Costera | about 45 x 45 x 240; tower | **ANCHOR** (adopt as the silhouette of `firm-tower` (3600,1300) rather than a new landmark; R2 puts it at (3294,1243), 300 m west) | city-core (3294, 1243) or fold into `firm-tower` | TL | **yes `paitilla-towers`**, centre 8.9810, -79.5160, size_m 1000 (about 1 km2, F&F at the north edge, Multiplaza 0.5 km NE; reaches Paitilla point) | building heights (tower strip), street grid, block fill |
| **P9 `punta-vela`** (sail-shaped hotel-tower on Punta Pacífica; brand not used) | [mem] about 8.977, -79.508 (near SIG Pacífica [OSM] 8.9764, -79.5079); +2.9 E, +2.7 N | Curved, sail-like tower, the tallest of the point | about 60 x 60 x 280; tower | FILL (one silhouette for `valeria-penthouse` (3800,1100)) | city-core (3900, 640) is the shore vertex: use (3800,1100) | TL | covered by `paitilla-towers` only partly (it is outside); no | building heights |
| **P10 `plaza-del-sol`** (Multiplaza-style mall) | 8.98549, -79.51077 [OSM]; +2.63 E, +3.67 N | Big mall pad and parking decks, a podium among towers | about 220 x 160 x 25; commercial | FILL | city-core (3712, 1316) (R2) | TL | covered by `paitilla-towers` | block fill |
| **P11 `avenida-central`** and **Plaza 5 de Mayo** (pedestrian shopping street; Line 1 station, old tram ring) | [mem] about 8.955, -79.537, +-300 m; about -0.3 E, +0.3 N | Crowded pedestrian strip, arcades, vendors; the gateway between Casco and Calidonia | strip about 900 x 15; commercial | FILL (street + crowd density, no landmark) | city-core (2300, 640) (R1) | L | **yes `el-chorrillo`**, centre [mem] 8.9515, -79.5445 (Chorrillo / Santa Ana / foot of Ancón; the quarter `tito-city-room` is based on), size_m 800 | street grid, block fill, building heights (4-6 storey) |
| **P12 `isla-del-fuerte`** (Isla Flamenco, end of Amador causeway; marinas, cruise berth) | 8.90865, -79.52008 [OSM]; +1.60 E, -4.87 N | Flat island at the end of the causeway; marinas with masts, a cruise dock | about 400 x 250; water | FILL | existing `causeway-islands` polygon: on_water (1625, 200). R1 not valid at 5 km; pinned to the polygon (SIG anchor `Amador Causeway`). The simple R1 point (1620,190) was **off land**, so keep it on_water | TL | no (off-land / causeway) | n/a |

### B2. Transit

| id | Real lat, lon (grade); offset | Recognisable | Scale; kind | Verdict | District, proposed | Aud. | engine fragment? | what to measure |
|---|---|---|---|---|---|---|---|---|
| **P13 `metro-linea-2`** (elevated Line 2, San Miguelito to Nuevo Tocumen, plus the Tocumen branch stations Corredor Sur / ITSE / Aeropuerto) | [web] stations list (San Miguelito, Brisas del Golf, Cerro Viento, San Antonio, Pedregal, Don Bosco, Corredor Sur, Las Mañanitas, Hospital del Este, Altos de Tocumen, 24 de Diciembre, Nuevo Tocumen; Aeropuerto branch opened 2023); line 21-23 km, entirely elevated; no coordinates; Pedregal station sits in the existing `pedregal` fragment (9.0728, -79.4266 [OSM-registry]) | A viaduct on concrete columns with a light-rail track, snaking over the corridor; a shadow band across roads. Mid-block stations with a canopy | viaduct 8-10 wide, 12 high, columns every 30 m; transit | **ANCHOR** (route skeleton in Act 1 rect: skeleton only, no station interiors) | tito-corridor: polyline [(4500,3350),(4800,3000),(5100,2700),(5400,2300),(5550,1800)] from `miguelito-hills` to `passenger-terminal` [mem-derived] | TL | no (Pedregal and Tocumen fragments already cover it; measure viaduct height from them) | building heights (viaduct), POIs (stations) |
| **P14 `metro-linea-1`** (Albrook to San Isidro; San Miguelito interchange) | [web] Albrook south terminus, runs roughly N-S, maintenance yard at Albrook; no coordinates | Elevated in the north (Transístmica), underground in the city; surface = station kiosks | transit | FILL | route from `albrook` (1800,1800) to `miguelito-hills` (4500,3400); stations as small cover | L | no | POIs |
| **P15 `albrook-gelabert`** (airfield) | covered by SIG | | | (SIG) | | | | |

### B3. Canal zone, Gamboa, Soberanía

| id | Real lat, lon (grade); offset | Recognisable | Scale; kind | Verdict | District, proposed (x,y) | Aud. | engine fragment? | what to measure |
|---|---|---|---|---|---|---|---|---|
| **P16 `torre-del-bosque`** (Rainforest Discovery Center observation tower) | 9.13349, -79.72084 [OSM] (a kiosk node of the centre); -20.4 E, +20.1 N | A 30 m steel tower over a canopy trail, a visitor building and ponds on the park edge | tower about 6 x 6 x 30; nature | FILL | canal-central (1170, 3750) (R4) | T | no (single site) | n/a |
| **P17 `camino-del-oleoducto`** (Pipeline Road, 17 km track into forest) | 9.12900, -79.71545 [OSM] (road way); -19.8 E, +19.6 N; length [web] 17 km | A straight gravel track with a tunnel of trees and a pipe along it | 17,000 x 6 (real); route | FILL | canal-central: route [(1450,3680),(1850,3900)], capped at 0.5 km because the lake cells start at y=4000 | T | no | relief |
| **P18 `domo-del-radar`** (Canopy Tower, a yellow radar dome on a ridge used as a birding lodge) | [mem] about 9.08, -79.69 (south of Gamboa on Semaphore Hill, +-2 km); about -16 E, +14 N | A white/yellow geodesic dome on a hilltop; unique silhouette | about 20 x 20 x 12 on a 150 m hill; historic | **ANCHOR** (cheap, unique, gives the jungle ridge a hero silhouette) | canal-central about (1500, 3250) (R4 from Gamboa) | T | no (single building) | n/a |
| **P19 `jardin-de-la-cumbre`** (Summit Gardens: park, zoo, botanic) | [mem] about 9.082, -79.648 (+-2 km; searched, no coordinates returned; [web] it is a city-run park); about -12.5 E, +14.2 N | Open lawns, cages, a canopy trail on the road to Gamboa | about 300 x 200; nature | FILL | canal-central (1960, 3170) (R4) | TL | no | n/a |
| **P20 `isla-del-laboratorio`** (Barro Colorado, research island in the lake) | [mem] about 9.152, -79.847 | A lake island with a dock and research station | about 5 km x 3 km real; nature | FILL (one of the `lake-islands`) | gatun-lake: in `lake-islands` (1050, 4500) on water (not on the channel) | T | no (off-land) | n/a |
| **P21 `esclusas-gemelas`** (Agua Clara, the larger Atlantic locks with water-saving basins) | 9.32246, -79.75831 [OSM]; -24.5 E, +41.1 N | Huge chambers with stepped water-saving basins; much bigger than old locks | about 500 x 70 chambers; canal | FILL (large sibling of `atlantic-locks`; only if Act 3 needs it) | colon: squeezed to the E edge of the Colón cells: (2940, 6245) (1:40 E / 1:20 N from `free-zone`: 13.7 km E and 3.1 km S real) | T | no (structure, 1+ km) | n/a |
| **P22 `presa-del-lago`** (Gatún Dam + spillway) | [mem] about 9.268, -79.925 | A wide concrete spillway across a river with a hydro station | about 200 x 50; industrial | FILL | colon, next to `atlantic-locks` (500,6500) around (600,6450) | T | no | n/a |
| **P23 `gatun-vista`** (Gatún Locks viewing) | 9.27397, -79.92307 [OSM] | | | DROP (same as `atlantic-locks`) | | | | |
| **P24 `aldea-del-rio`** (Emberá villages on the Chagres river) | [mem], Chagres / Alajuela | cultural, small | | DROP (people-specific, risk of caricature; not a landmark) | | | | |

### B4. Colón, forts, Caribbean coast, islands

| id | Real lat, lon (grade); offset | Recognisable | Scale; kind | Verdict | District, proposed (x,y) | Aud. | engine fragment? | what to measure |
|---|---|---|---|---|---|---|---|---|
| **P25 `puerto-de-cruceros`** (Colón 2000 cruise terminal + Columbus statue at Cristóbal) | [mem] about 9.365, -79.915 | A pier with a white liner and a statue on the seafront | about 350 x 40 pier; transit | FILL | colon (1650, 7500) on the peninsula (land-checked) | T | no | n/a |
| **P26 `fuerte-de-la-bahia`** (Fort Sherman, jungle fort at the bay mouth) | 9.36492, -79.95247 [OSM]; -45.8 E, +45.8 N | Old gun batteries in jungle across the bay | about 600 x 300 ruins; historic | FILL (horizon hint, west of the playable edge) | colon, skirt (60, 7300) on land (checked) | T | no | n/a |
| **P27 `fortin-del-rio`** (Fort San Lorenzo, ruin on a cliff at the Chagres mouth) | 9.32259, -80.00254 [OSM]; -51.3 E, +41.1 N | Stone fort on a headland over a river mouth | about 200 x 100 x 15; historic | FILL (off-edge hint; no unique value on a 6 km map) | colon, skirt (30, 6800) (land-checked) | T | no | n/a |
| **P28 `bahia-del-cristo`** (Portobelo: ruined fort wall, customs house, black-Christ church) | 9.55382, -79.65493 [OSM] (town); +-13.2 E, +66.8 N. Real offset from Colón about +26.5 km E | Stone wall and cannons on a coral bay with an old customs house; a church with a dark Christ procession in October [mem] | about 300 x 120; historic | FILL (reuse the existing hidden-cove landmark; the cove gets a ruined wall so it reads as a recognisable place) | jungle-ridge at `caribbean-cove` (4500,6650): ruin at (4350, 6700) (land-checked, 1:10 from Colón) | TL | **yes `portobelo-bahia`**, centre 9.5538, -79.6549, size_m 800 | street grid, POIs, relief |
| **P29 `isla-lejana`** (Taboga, island 18 km south of Casco, a hill with a small town) | 8.78952, -79.56074 [OSM]; -2.85 E, -18.1 N | A green island silhouette on the southern horizon at dusk | about 4 km x 2 km; island | FILL (off-map horizon sprite) | sea, beyond y=0 | T | no (off-land) | n/a |
| **P30 `perlas`** (Pearl Islands) | [mem] 60 km SE | | | DROP (beyond any usable horizon) | | | | |
| **P31 `arco-chato`** (ruined arch in the old city) | [mem] | | | DROP (too small, covered by Casco fill) | | | | |
| **P32 `parque-soberania`** as a place | OSM 9.15510, -79.71179 [OSM] | | | DROP (it is **land cover**, `jungle-ridge`, not a landmark) | | | | |

Counts: 32 rows. **ANCHOR 5** (P1, P2, P8, P13, P18). **FILL 21** (P3-P7, P9-P12, P14, P16, P17, P19-P22, P25-P29 and the `fuerte-de-la-bahia`/`fortin-del-rio` hints are inside this). **DROP 6** (P23, P24, P30, P31, P32 and the P15 pointer which is not a place). Check: 5 + 21 + 6 = 32, with P15 counted as DROP.

### B5. Corrections to SIG found while verifying

| Item | SIG says | This pass | Effect |
|---|---|---|---|
| **Panamá Viejo ruins** | [mem] 8.9953, -79.499 (+3.9 E, +4.8 N) | [OSM] "Conjunto Monumental de Panamá Viejo" **9.00841, -79.48557**: **+5.39 E, +6.21 N** (8.2 km from Casco). About 2.2 km NE of SIG's memory value | The Pacífica-to-Panamá Viejo gap is 3.3 km (not 2.4); the 1:6 squeeze becomes about 1:8, still the K/E seam (3900,1020). Costa del Este [OSM] 9.0132, -79.4681 is now only 2.0 km from the ruins |
| **Mercado de Mariscos** | [OSM] 8.9583, -79.539 | consistent: [OSM] 8.95830, -79.53899 | none |
| **Biomuseo** | [OSM] 8.9323, -79.5446 | consistent: [OSM] 8.93193, -79.54477 | none |
| **Ancón peak** | [OSM] 8.9576, -79.5492 | consistent: [OSM] 8.95765, -79.54920 | none |
| **Multiplaza** | not listed | [OSM] 8.98549, -79.51077; SIG "Banking district / Calle 50" is [mem] 8.985, -79.521: about 1 km west of the mall | none |

### B6. Fragment candidates among places that already exist (for the geospatial engine)

All sized for the 800 m default (0.64 km2), well below the 2 km2 cap. Existing slugs are not repeated.

| Proposed slug | Place (id) | Centre lat, lon (grade) | size_m | Why | What to measure |
|---|---|---|---|---|---|
| `casco-viejo` | `old-quarter` (+P1-P5) | 8.9520, -79.5340 [OSM-derived from P1/P2/P3 centres] | 800 | Real block grid at 60-80 m, plaza spacing, heights 3-4 storeys | street grid, block fill, building heights, POIs |
| `el-chorrillo` | `tito-city-room` | 8.9515, -79.5445 [mem] | 800 | Dense working-class blocks; a Chorrillo-like pattern | street grid, block fill, building heights |
| `paitilla-towers` | `firm-tower`, `valeria-penthouse` (+P8, P10) | 8.9810, -79.5160 [OSM-derived] | 1000 | The tower strip: height distribution, footprint, setback to the bay | building heights, block fill, relief (reclaimed flat) |
| `panama-viejo-ruins` | Panamá Viejo (SIG) | 9.0084, -79.4856 [OSM] | 800 | Ruins on a shore with mangrove behind; low density | block fill, relief, POIs |
| `costa-del-este` | `gated-community` | 9.0132, -79.4681 [OSM] | 800 | Formal reclaimed grid with towers | street grid, building heights |
| `albrook-terminal` | `albrook` | 8.9731, -79.5518 [OSM] (Albrook Mall) | 800 | Bus terminal + mall + rail; large footprints | block fill, POIs |
| `gamboa-town` | `gamboa` | 9.120, -79.699 [mem] | 800 | Canal-zone village: lawns, white houses on stilts | street grid, building heights |
| `colon-old-town` | `neto-building`, `colon-ballfield` | 9.359, -79.900 [mem] (Colón centre; verify before import) | 800 | Colón core tenement grid | street grid, block fill, building heights |
| `portobelo-bahia` | P28 | 9.5538, -79.6549 [OSM] | 800 | A real coastal fort town for `caribbean-cove` | street grid, POIs, relief |

Not a fragment (reason): single buildings (P3, P4, P6, P7, P9, P18), off-land or causeway (P12, P20, P29), structures longer than the
square (P13 viaduct, P17 road, P21 locks), hints at the edge (P26, P27).

## C. Vibe rules for the procedural generator

Numbers are design targets from memory of the real places ([mem]); use them as ranges and verify with the fragments in B6 after
measurement.

| # | District id | Rule |
|---|---|---|
| V1 | `city-core` (Casco area, around `old-quarter`) | 1-3 storey blocks (6-14 m) on a **60-80 m** street grid with 8-10 m streets; ~100 % lot coverage along the street; **pastel facade palette** (ochre, salmon, teal, cream, faded blue, with stucco chips); wooden or iron **balconies** on 40 % of upper facades; pitched clay roofs plus flat roofs with water tanks; 5-6 plazas of 60-90 m with a church at one side; sea wall of 6 m on the sea sides |
| V2 | `city-core` (tower strip along the bay) | 150-250 m towers (height lognormal, median 140 m, p90 230 m) in 1-3 rows **behind a 60-120 m linear park**; 40-70 m footprints with 25 m spacing; podiums of 15-25 m; palm rows along the avenue; 1 twisted or sail-shaped hero tower per 1.5 km |
| V3 | `city-core` (Chorrillo / Calidonia sub-band) | 4-6 storey concrete walk-ups, 12-20 m wide, 100 % lot coverage; laundry lines, flat roofs with water tanks, hand-painted signs; 12-18 m streets with narrow 4 m alleys; murals on 1 in 6 gable walls; a corner shop on every third corner |
| V4 | `city-core` -> `costa-del-este` seam | Switch from organic grid to **formal reclaimed grid**: 120-160 m blocks, 25 m boulevards, palms in rows, empty plots (30 % unbuilt), towers 80-150 m, security booths at the gated entrances |
| V5 | `costa-del-este` | 100-180 m tower blocks, gated compounds with 3 m walls, mall pads of 200 x 150 m, no street life: 0 vendors, 100 % tarmac plots, rows of palms along the 30 m boulevard |
| V6 | `tito-corridor` (San Miguelito hills) | 1-3 storey self-built concrete houses stacked on 15-25 % slopes; irregular 3-6 m stair-streets; zinc and flat roofs with water tanks; bright painted facades at 1 in 4 houses; bus loop at each ridge junction; **elevated Line 2 viaduct** crossing the district on columns every 30 m, 12 m high |
| V7 | `tito-corridor` (avenue + market) | Strip: 20 m avenue, a red-painted bus every 60 m of road (diablos rojos), stops every 250 m, covered stall rows (3 x 3 m stalls in rows, tarpaulin awnings), a pharmacy and a fonda on corners, kerbside puddles when rain is on |
| V8 | `colon` (old town vs Free Zone) | Two rule-sets sharing one seam: **old town** = 2-3 storey wooden/concrete tenements with 2 m balconies running the full facade, gaps (every 5th lot is rubble), peeling pastel, 18 m streets in a rectangular grid of 70 x 100 m; **Free Zone** = a walled grid of 100 x 150 m warehouses/showrooms, 6 m perimeter wall, 2-3 guarded gates, crisp asphalt, no balconies |
| V9 | `pacific-locks` / `canal-central` (Zonian zone) | White clapboard houses on 0.8 m stilts with screened porches and red tin roofs, 25-35 m lots on **wide lawns** (40 % green), rows of royal palms, English-language signs, a chapel and a commissary; Albrook-type block = big footprint mall/terminal, 300 x 200 m |
| V10 | `jungle-ridge` / `canal-central` edge | Rule: **forest touches the last house**: 20-40 m belt of dense canopy between built-up and cleared land; vine-covered ruins (concrete bunkers, 8-15 m) every 1.5 km; tracks end in green; cleared fringe uses red earth |
| V11 | `sea` (bay) | 15-25 **anchored ships** (80-300 m hulls) spread along the bay edge at 600-1500 m from shore, with a few container cranes at the ports and a pilot boat; at night a dotted line of lights; Taboga silhouette on the southern horizon |
| V12 | `airport` | Low flat sprawl, 150-300 m terminal frontage, cargo aprons, a ring road, 2-3 storey hotels with large signs, **aircraft low overhead** every 90-120 s (flight path over `tito-home`), tiny shops and chain-link fences at the edge; elevated Line 2 ends at the airport branch |

Cross-cutting dress rules (any district): wet-season light (diagonal late-afternoon showers), puddle decals at kerbs, flags and bunting
in November, Christmas lights in December, a mola-pattern awning on 1 in 12 stalls, Panamanian Spanish signage ("Se vende", "Lavandería",
"Fonda"), murals on 1 in 8 gable walls.

## What I could not verify

- Nominatim returned **no result** for: Catedral Metropolitana, Miraflores visitor centre, Summit Gardens, the Soberanía/Discovery
  tower as a named tower (only the Rainforest Discovery Center kiosk node was found), Metro stations (5 de Mayo, San Miguelito,
  Albrook, Cinta Costera), Plaza Cinco de Mayo, Pacific Multiplaza spelling variant. Those rows are [mem] or proxied from a neighbour.
- All heights and footprints are [mem]. No building data was read.
- Gamboa's real coordinate is [mem], so every R4 position is +-2 km real (about +-200 m on the map).
- The Soberanía-area positions (P18, P19, P20), Gatún Dam (P22), the Colón cruise terminal (P25) are [mem]; verify before using them in a fragment.
- No proposed point was checked against grid-cell district codes except where stated; the point-in-polygon check was against `geometry.land` only.
- Cultural facts in Part A (Carnaval, pollera, diablos rojos, weather) are general knowledge, not from sources fetched here.

Sources used: OpenStreetMap Nominatim lookups (ODbL), plus WebSearch pages: Wikipedia "Panama Metro" and Metro station pages, Rough
Guides and Fodor's Panama City pages, Afar "Gamboa's Summit Park", Lonely Planet / tourismpanama Soberanía pages.
