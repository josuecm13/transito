# 01 — Panama City: signature places and the bayfront structure

Goal (director, 2026-11-22): find the places that make Panama City recognisable, say how they could live in the EXISTING map,
and what structure results. The coast (`geometry.land`) does not change. Real places are inspiration only
(`inspired_by`, working names, never a 1:1 copy: CLAUDE.md "Contenido original").

Position grades: **[OSM]** read from OSM in this pass (Overpass, node/way centre); **[mem]** my memory, not verified, +-300 m or
worse. Map positions are **proposals** from point-in-polygon checks against the 37-point `geometry.land` (I ran them: every
existing city landmark listed below is on land) and the shore profile (south shore y at x=2000: 225; 2300: 120; 2500: 165;
2700: 685; 3000: 905; 3300: 925; 3600: 850; 3900: 555; 4200: 630). Real offsets are from Casco Viejo (8.9525, -79.5347).

## Verdict per place

| Place (working name idea) | Verdict | Real position, offset from Casco | Why recognisable top-down / 3rd person | Lands in the map (district, approx x, y) | Existing neighbours |
|---|---|---|---|---|---|
| **Casco Viejo** (`old-quarter`) | ANCHOR | [OSM] 8.9525, -79.5347; tip of a peninsula | Peninsula silhouette; tight small-block grid; low roofs, plazas; sea on three sides | city-core (2400, 400): **exists** (landmark `old-quarter`, tip of the peninsula, land point (2350,100)) | `tito-city-room` (2200,800), `coastal-avenue` start (2400,400) |
| **Cinta Costera 1 + 2** (bayfront strip: boulevard + linear park on reclaimed land) | ANCHOR (road + cover) | [OSM] ways at 8.957-8.9645 (trunk/primary), more at 8.9735-8.9768, -79.526..-79.516; 3.4 km trunk + 0.7 km motorway in OSM | A long green band between the avenue and the water: the strongest readable edge of the city | city-core, along the shore from (2650, 600) to (3600, 850). The existing `coastal-avenue` runs ~300-400 m inland of that shore (e.g. y=1200 at x=2700 vs shore 685), so the **gap is the strip**: park/reclaimed land, boulevard on its landward side | `coastal-avenue`, `firm-tower` (3600,1300), `valeria-penthouse` (3800,1100) |
| **Cinta Costera 3 marine viaduct** around Casco | ANCHOR if the director wants it (Question 10) | [OSM] ways `Cinta Costera` primary at 8.9462-8.9513, -79.5495..-79.5304 (south shore of Casco); `Avenida Balboa Viaducto` trunk 1.8 km | A road on pillars over water that rings the old quarter: unmistakable silhouette | Needs open water beside the peninsula. Map has **<= 100 m of sea south of the tip** (land (2350,100), south edge of the box is y=0), so only the east/bay side has room: offshore from (2700, 200) to (2900, 780). The real west half (towards Ancón) is dropped | `old-quarter`, `arch-bridge` (1300,400) on the other side |
| **Avenida Balboa** | FILL (name for the boulevard class) | [OSM] `Avenida Balboa` trunk 2.9 km, 8.959-8.976, -79.538..-79.521 | Wide avenue parallel to the shore, towers behind it | Same corridor as Cinta Costera: the `coastal-avenue` arterial | as above |
| **Punta Paitilla / Punta Pacífica** (point with towers) | ANCHOR | [OSM] Paitilla 8.9753, -79.5148 (+2.2 E, +2.5 N); Pacífica 8.9764, -79.5079 (+2.9 E, +2.7 N) | Point of land with a tower cluster; the bay turns here | Pacífica = the existing shore vertex (3900, 550) (comment in `world.yaml`: "Punta Pacífica point"); Paitilla about (3500, 1020) on the bayfront curve (y >= 1000: grid cells at x 3000-4000, y < 1000 are `S`, sea budget, and the landmark rule requires the grid cell's district) | `valeria-penthouse` (3800,1100) is the Pacífica-style tower; `firm-tower` (3600,1300) |
| **Banking district / Calle 50, Obarrio** | FILL (tower cluster, inland of Paitilla) | [mem] about 8.985, -79.521 (+1.5 E, +3.6 N) | Glass-tower grid one block set back from the bay | city-core, about (3350, 1700), 700 m inland of the bayfront | `taller-safehouse` (3100,1900), `tito-tower` (3300,2300) |
| **El Cangrejo / Vía España** | FILL | [OSM] El Cangrejo 8.9898, -79.5273 (+0.8 E, +4.1 N) | Dense mid-rise commercial spine, inland | city-core (2800, 2600): **exists** as `valeria-apartment` (El Cangrejo-style) | `tito-tower` |
| **Panamá Viejo ruins** | ANCHOR (low detail) | [mem] about 8.9953, -79.499 (+3.9 E, +4.8 N); [OSM] Coco del Mar 8.9959, -79.4966 next to it | Stone ruins on the shore with a tower silhouette; marks the end of the old city | Real order puts it between Pacífica and Costa del Este. At the city's 1:3 it would land at x about 4400, inside the Act 1 rect. Propose the K/E seam: (3900, 1020), city-core (grid cell K starts at y=1000), **outside** the Act 1 rect (x < 4000) so it stays grey | shore vertex (3900,550); `gated-community` (4500,900) |
| **Costa del Este** (`costa-del-este`) | ANCHOR | [OSM] 9.0132, -79.4681 (+7.3 E, +6.7 N), 9.9 km from Casco | Reclaimed formal grid with towers, causeway-like edge | **Exists**: district E, x 4000-5000, `gated-community` (4500, 900). Map distance from Casco 2.1 km, real 9.9: 1:4.7 | Act 1 border |
| **Corredor Sur** (expressway along the bay) | ANCHOR (main road), existence is Question 10 | [OSM] motorway, 37.3 km summed ways, 8.977..9.069, -79.517..-79.401: starts at the Paitilla / Cinta Costera east end and runs NE along the bay to Tocumen. That it crosses water or reclaimed ground near Panamá Viejo is [mem], not checked | A fast elevated road hugging the shore and ending at the airport | Proposed `corredor-sur` route from (3400, 1000) hugging the shore (offset 60-120 m inland of the shore, or offshore if marked a causeway) to the airport: ends at (5300, 1200) cargo apron. Crosses the Act 1 rect: **skeleton only** there | `coastal-avenue` end (4500, 900), `corridor-avenue` end (5300, 1200) |
| **Amador Causeway + Biomuseo** | ANCHOR | [OSM] Calzada de Amador 8.9199, -79.5328 (south); Biomuseo 8.9323, -79.5446 (-1.1 E, -2.2 N) | A thin road on a rock-fill ribbon with islands, the Biomuseo roof as a colourful landmark | **Exists** as `causeway` route (1350,450)-(1600,200) and `causeway-islands`. Biomuseo: `on_water` landmark near (1480, 330), proposal | `arch-bridge`, `causeway-islands` |
| **Bridge of the Americas** (`arch-bridge`) | ANCHOR | [OSM] `Puente de las Américas` trunk 1.7 km, 8.941..8.947, -79.571..-79.557 (-3.2 E, -0.9 N, 3.4 km from Casco) | Steel arch over the canal mouth | **Exists**: (1300, 400) `on_water`, 1.1 km from `old-quarter` (real 3.4: 1:3). Canal route passes within about 30 m | `canal`, `causeway` |
| **Puente Centenario** (`cable-bridge`) | ANCHOR (canal layer, not city) | [OSM] node at 9.0238, -79.6377 is suspect (my memory puts the bridge near the Culebra Cut about 4 km NE); unresolved, check with a `bridge=yes` way query | Cable-stayed deck over the cut | `cable-bridge` (700, 3300) `on_water`; **inconsistency**: the `canal` route at y=3300 is at x about 1262, so the landmark is about 560 m west of the channel, and there is no lake/cut polygon to be "on water" | `gamboa` (1300,3600) |
| **Miraflores locks** | ANCHOR (canal layer) | [OSM] 8.9975, -79.5906 (-6.1 E, +5.0 N, 7.9 km) | Two chambers, ship in the lock, visitor deck | **Exists** `pacific-locks` (1400, 1500); 1.5 km from Casco (real 7.9: 1:5.3) | `balboa-port` (1200,1100) |
| **Ancón Hill** | ANCHOR (relief) | [OSM] peak 8.9576, -79.5492 (-1.6 E, +0.6 N) | A single green hill over the old city with a flag; the only high ground in the core | Not in the spec. Proposal: authored hill near (1900, 950), between Balboa and Casco, 200 m class (real about 200 m; slope bands per relief rule, heights scaled) | `old-quarter`, `tito-city-room` |
| **Parque Natural Metropolitano** | FILL (cover) | [OSM] 8.9854, -79.5467 (-1.3 E, +3.7 N) | A green wedge of forest inside the city | A `forest` land-cover patch inland of Albrook / Cangrejo, about (2300, 1900) | `albrook` (1800,1800) |
| **Albrook + Marcos A. Gelabert airfield** | ANCHOR (airport layer) | [OSM] Albrook Mall 8.9731, -79.5518 (-1.9 E, +2.3 N); runway-like way 1,504 m at lon -79.555, 8.966-8.981 (name not tagged on the way) | A short strip next to a bus terminal and a mall | `albrook` landmark (1800, 1800) exists (bus terminal, mall, rail terminus). A strip must sit east of the canal (x about 1300 at y=1800..2500) and south of y=3000 (grid cells above are lake budget): room for about **1.0-1.1 km**, not 1,504 m, unless set diagonally | `albrook`, `railroad` end (1800,1800) |
| **Mercado de Mariscos** | FILL (small anchor, optional) | [OSM] way 8.9583, -79.539 (-0.5 E, +0.6 N) | Market building on the shore at the start of Cinta Costera | On the bayfront strip near (2740, 760); needs a land check (shore at x=2740 is y about 750) | `old-quarter` |
| **Coco del Mar** | DROP | [OSM] neighbourhood node 8.9959, -79.4966 | Residential, no distinct silhouette; same position as Panamá Viejo | covered by the Panamá Viejo anchor | |
| **Calidonia / El Chorrillo** | already in spec | n/a | Dense, working-class blocks next to Casco | `tito-city-room` (2200,800), `taller-safehouse` (3100,1900) | exist |

Dropped or merged: Coco del Mar (merged), Vía España (merged with El Cangrejo), Avenida Balboa (a road class, not a place).
Not found/verified: the exact trace of the Corredor Sur offshore stretches, the Puente Centenario position, Panamá Viejo ruins
position (memory).

## Resulting structure: the bay as a spine

The city is organised as **a chain along one curve of coast**, read left to right (west to east) in the map. Order is real; gaps
are compressed per pair (the existing city is 1:3; `specs/map/README.md`).

| # | Segment | Real gap | Map gap | Ratio | Notes |
|---|---|---|---|---|---|
| 1 | Bridge of the Americas -> Casco | 3.4 km | 1.1 km | 1:3 | Ancón Hill and Amador sit in between |
| 2 | Casco -> Cinta Costera 1/2 (Mercado) | 0.8 km | about 0.4 km | 1:2 | the viaduct wraps the tip |
| 3 | Casco -> Paitilla | 3.3 km | about 1.1 km | 1:3 | strip of reclaimed park between avenue and shore |
| 4 | Paitilla -> Punta Pacífica | 1.0 km | about 0.4 km | 1:2.5 | tower point |
| 5 | Pacífica -> Panamá Viejo | 2.4 km | about 0.4 km (to (3900,1020)) | 1:6 | the squeeze: otherwise it enters the Act 1 rect. Say so; alternative is a different Act 1 rect (not in scope) |
| 6 | Panamá Viejo -> Costa del Este (`gated-community`) | about 4.4 km | 0.6 km | 1:7 | beyond x=4000 is the Act 1 rect |

Anchors (carry a unique silhouette and a name; each gets a landmark with `inspired_by`): Casco, Cinta Costera strip, viaduct
(optional), Punta Pacífica, Panamá Viejo, Costa del Este, Amador + Biomuseo, Bridge of the Americas, Miraflores, Ancón Hill,
Albrook airfield (optional). Fill (no landmark; carried by district rules and land cover): Banking district, El Cangrejo,
Avenida Balboa, Metropolitano park, Mercado.

### How it fits the layer order

| Layer | What the city contributes | Act |
|---|---|---|
| 1 Land cover | Bayfront park/reclaimed strip, Metropolitano forest patch, mangrove at Panamá Viejo/Costa del Este shore, built-up mask of the core as a coarse class (no streets) | whole isthmus (decision 3) |
| 2 Relief | Ancón Hill, flat reclaimed strip (cap like `costa-del-este` cap 3 m), airport flats | whole isthmus |
| 3 Rivers + canal | Canal mouth at the bridge; urban rivers (Matías Hernández, Curundú in `real-geography.md`) as channels under the city | whole isthmus |
| 4 Airports | Albrook airfield (optional), Tocumen | whole isthmus; Tocumen is Act 1 |
| 5 Main roads | **Cinta Costera** (boulevard + viaduct), **Corredor Sur**, Interamericana through the city, `coastal-avenue` | whole isthmus (skeleton: centreline, class, grade, bridges) |
| 6-9 Secondary, streets, blocks, buildings | The Casco grid, the tower blocks, Calle 50 | **not Act 1** (CLAUDE.md rule 3; `world.yaml` notes first use the city in later acts: `tito-city-room` "from Act 2", `tito-tower` "Act 4", `taller-safehouse` "Act 5"). Grey blocks only until the director tags an act |

The coastway is therefore a **main-road + land-cover** feature, not a city-detail feature: its skeleton ships with layers 1 and 5
over the whole isthmus; the Casco street pattern, the towers and the market interiors wait for their act.
