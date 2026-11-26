# 03.12 — Sectors, portals and streaming (the isthmus as a PS2-style world)

Status: **design proposal; the director answered the open questions on 2026-11-25 (section 8 lists the decisions and what each changed; marks "ANSWERED" below)**. Nothing here is built. It is an ADAPTATION: real places and real crossings give
numbers and character only; the partition, the portals and every name below are the game's own (CLAUDE.md "Contenido original",
director's hard rule: not 1:1).

## 0. How to read this file

| Tag | Meaning |
|---|---|
| **[M]** | measured. Either quoted from a source file (path given) or **[M*]** measured in this pass by a throw-away Node probe that generates the isthmus exactly as the bake does (`parseWorldWithEdits(world.yaml + specs/map/procedural-edits.json)` -> `generateIsthmus`, then `gameSpecFromIsthmus`, `generateStreets`, `deriveCity`; 6-8 s, 236 MB RSS in Node). The probes lived in `/tmp/transito-orch/` (`seam-probe*.ts`, `sector-probe*.ts`, `city-probe.ts`, `lake-probe.ts`) and are NOT in the repo; card 1 (section 6) turns them into `tools/sector-probe.ts` |
| **[E]** | estimated from code or arithmetic; no run behind it |
| **[P]** | proposed value (a design choice, to be confirmed or re-derived after the baseline) |
| **to-measure** | unknown today; no number is invented |

Sources: `/tmp/transito-orch/audit.md` (render/memory audit, "AUD" below), `docs/map-reshape/01-investigation/panama-essence-and-tourism.md`
("ESS", 32-place catalogue, vibe rules V1-V12), `panama-city-signature-places.md` ("SIG"), `/tmp/transito-orch/real-crossings.tsv`
(688 real ways: 648 bridge, 40 tunnel), `specs/map/world.yaml`, `specs/map/districts.md`, `specs/map/fragments/*.yaml`,
`docs/map-reshape/03-technical/{00,04,11}-*.md`, Map Studio (`docs/map-reshape/map-studio-*.md`, `src/studio/{params,guards,presets}.ts`).
Tag **[D]** (added 2026-11-25) = a number the director verified and reported (airport terrain figures in 8.4); treated as measured, not re-run here.

### 0.1 Three corrections to the inputs that change the design (verify before planning on them)

1. **The Act 1 rect in AUD (x 3584-5775, y 573-3370, 6.13 km2, 1,358 buildings, 545 edges) is from `world.yaml` alone.** The bake and the
   game apply the 6 saved Map Studio edits in `specs/map/procedural-edits.json` (airport hint, `city`/`colon` road stops, `bay-east`,
   `casco`, `colon` transit stops; `tools/bake-isthmus.ts:16`). With them, **[M]** the rect is **x 3588-5450, y 562-3610
   (1862 x 3048 m = 5.68 km2)** (source: orchestrator, 2026-11-25, `parseWorldWithEdits` + `generateIsthmus` + `gameSpecFromIsthmus`, after the airport grading (card 1)), Tito's anchor is (4288, 1263) and the passenger terminal (4753, 2905); the previously quoted
   x 3056-5465, y 824-3782 (7.13 km2), anchor (4179, 1581), terminal (4904, 2667) were measured before the grading moved the anchor and are **stale**. Street edges and buildings for the new rect are **unknown** (re-measure in card 0); the older 61 ms / 612 edges / 197 ms / 1,160 buildings (all `tito-corridor`) belong to the stale 7.13 km2 rect. `gameSpecFromIsthmus` still drops
   `taller-safehouse, firm-tower, valeria-penthouse, tito-tower, gated-community` (reason not read). The "6.13 km2 / 1,358" pair is stale for sizing.
2. **The generated canal and lake are not where the authored `routes.canal` / landmarks say.** **[M*]** generated centreline x at y = 455 / 1473 /
   2400 / 3220 is 1188 / 1351 / 1450 / **1601**; the authored line is x 1262 at y 3300. The authored `cable-bridge` (1262, 3300) is about 340 m
   off the generated channel. The generated lake spans x 0-3100, y 3140-6480 (5.00 km2, level 72 m), not the authored 8 km2 around (1500, 5000).
   Legacy authored landmark coordinates are therefore unreliable; **portals and anchors must be placed by rule from the generated map**, the way
   `procedural.landmarks` already places the five Act 1 landmarks (`world.yaml` "by rule, never by coordinates").
3. **Map Studio `reset` is not "back to where I started".** It empties the working edits (`working: []`), which differs from the saved 6.
   `revert` (to saved) restores the starting state. Both were used in section 5; final state confirmed (revision `12c2de4ba2fd23`, saved 6 / working 6).

## 1. Sector partition of the whole isthmus

**ANSWERED (Q1, 2026-11-25): the 7-sector partition below is accepted as written.** Consequences: (a) `corredor` keeps the whole east bayfront; (b) `cordillera` is plain jungle backdrop (silhouette tier, no road, no portal) **except one hiking trail near the airport, which lives inside `corredor`, not in `cordillera`** (section 8.3); (c) the two borders with no designed portal (`ciudad`/`corte` y 2400 and `corte`/`ribera`) are NOT given portals: under decision 4 they are plain **seamless seams** (flat 60 m plain, streaming by distance only, section 3.3); the earlier "move the border to y ~3150 and merge `corte`" default is withdrawn **[P]**. Because those two seams still carry a road/rail/canal each, the guard `portals-connect-adjacent-sectors` must treat "seamless seam" as a legal designation (8.5).

### 1.1 Principles

| # | Rule | Why |
|---|---|---|
| S1 | Borders follow seams the generated map already has: the canal, the Gatún lake, the divide south of the lake, the cordillera, the bay. Where no seam exists (the city/corridor plain) the border is a straight line placed to give **one crossing bundle**, and that bundle is where the portal goes | the director's request; fewer crossings = fewer portals |
| S2 | The Act 1 sector contains the derived Act 1 rect **plus** the 120 m fine-grid margin (`world.yaml` `relief.grid.margin`) | one resident sector for the whole act; guard `act1-sector-contains-act1-rect` (section 5) |
| S3 | The **sea is not a sector**: one global shell (sea plane + coast skirt + anchored-ship impostors, V11) is always resident and costs two meshes today (AUD s2, `meshes.ts:134-164`) | PS2 practice: the ocean is an always-on layer |
| S4 | The whole 6000 x 8000 box is tiled: every cell has exactly one owner (sea cells belong to the adjacent land sector) | guard `sectors-cover-extent` |
| S5 | Detail tier follows CLAUDE.md rule 5: only the Act 1 rect is `full`; everything else is `blocks` (grey blocks) or `silhouette` | one act at a time |

### 1.2 The partition (7 land sectors + the sea shell)

Extents are bounding boxes; the real border is the listed polyline. Areas are **[M*]** on the 20 m generation grid (120,000 cells = 48.00 km2 total, checked).

| id (working name) | Border (x, y m) | Box km2 | Dry land | Lake | Sea cells | Built (towns) km2 | Max h m | Cells @20 m | Slice @~88 B/cell [E] |
|---|---|---|---|---|---|---|---|---|---|
| `limon` (Bahía de Limón: port town, Atlantic locks) | x 0-3300, y >= 6500 | 4.95 | 3.16 | 0 | 1.79 | 0.59 | 240 | 12,375 | 1.1 MB |
| `lago` (Lago Gatún and its east-shore road) | x 0-2900, y 3150-3950, plus x 0-3300, y 3950-6500 | 10.77 | 5.77 | 5.00 | 0 | 0 | 458 | 26,925 | 2.4 MB |
| `corte` (the divide and Gamboa: Culebra-cut waist) | x 0-2900, y 2400-3150 | 2.15 | 2.15 | 0 | 0 | 0.01 | 280 | 5,375 | 0.5 MB |
| `ribera` (west bank of the canal, Balboa port) | y 0-2400, west of the canal polyline (x ~1190-1450) | 3.09 | 1.91 | 0 | 1.19 | 0.45 | 153 | 7,725 | 0.7 MB |
| `ciudad` (Casco to Albrook, bayfront to x 2900) | y 0-2400, between the canal and x 2900 | 3.87 | 3.34 | 0 | 0.53 | 1.28 | 79 | 9,675 | 0.9 MB |
| **`corredor`** (**Act 1 sector**: corridor, airport, Costa del Este, east bayfront) | x 2900-6000, y 0-3950 | 12.21 | 10.56 | 0 | 1.65 | 1.06 | 341 | 30,525 | 2.7 MB |
| `cordillera` (the range, Caribbean cove, no road in) | x >= 3300, y >= 3950 | 10.96 | 7.44 | 0 | 3.52 | 0 | 552 | 27,400 | 2.4 MB |
| **total** | | **48.00** | | | | | | 120,000 | 10.6 MB (matches the 10,609,120 B bake, AUD s1) |

Notes: "Slice" is the bake's average bytes per cell (AUD estimate, 88 B) times the cells; it is the sum that reproduces the measured 10.6 MB, so
it is consistent but still an estimate per sector. Dry land + lake + sea per sector adds to the box (checked on the printed rows). The `ciudad`/`ribera`
split follows the generated canal x(y) (the probe uses that polyline as the border).

### 1.3 Contents, tourist anchors, tier, neighbours

Catalogue ids are from ESS section B (P1..P32); working names are the game's. Positions in ESS are in the **authored** frame; those marked "by rule" must
be re-placed on the generated map (correction 2). "Fragment measured" = `specs/map/fragments/*.yaml` exists; **Paitilla and Albrook fragments were NOT measured
(import timed out)**: every claim about tower-strip or terminal footprints is from memory (ESS **[mem]**).

| Sector | Districts it holds | Landmarks / ANCHORs (adapted) | Tier | Neighbours (portal ids, section 2) |
|---|---|---|---|---|
| `limon` | `colon` | `container-port`, `free-zone` (authored (2600, 6400) sits on a 150-250 m hill in the generated relief and 100 m on the `lago` side of the border: move by rule or move the border to y 6350), `neto-building`, `colon-ballfield`, `atlantic-locks` (generated lock (990, 6450)), FILL: `puerto-de-cruceros` P25, `presa-del-lago` P22, `esclusas-gemelas` P21, off-edge hints `fuerte-de-la-bahia` P26 / `fortin-del-rio` P27. V8 two rule-sets (old town vs walled Free Zone) | blocks (Act 3+) | `lago` (P9 locks, P10 dam road). No fragment for Colón measured (`colon-old-town` only a candidate in ESS B6) |
| `lago` | `gatun-lake` | `lake-islands`, FILL `isla-del-laboratorio` P20 (a lake island with a dock), ships in the channel, the Transístmica along the east shore (it stays inside this sector from y 3953 to 6500, **[M*]**) | silhouette (lake = one flat quad + low island meshes) | `limon` P9/P10, `corte` P7/P8, `corredor` P5, `cordillera` none (only a river crosses) |
| `corte` | `canal-central` | `gamboa` (generated town seed (1420, 3050)), FILL `jardin-de-la-cumbre` P19, `torre-del-bosque` P16, `camino-del-oleoducto` P17 (capped 0.5 km), ANCHOR `domo-del-radar` P18 (rule: highest dry cell within 700 m of the Gamboa seed, instead of the authored (1500, 3250) which lands in `lago`). V9 Zonian lawns, V10 forest touches the last house | silhouette | `lago` P7/P8, `ciudad` (none: the border is flat plain, 60 m max, canal and a river only), `ribera` (none by road: gamboa-road and railroad run on the west bank, **[M*]** crossings at (1250, 2404) and (1260, 2400)), `corredor` (Transístmica graze at (2900, 3125)) |
| `ribera` | `pacific-locks` west half | `balboa-port` (authored (1200, 1100)), the west hills, the west end of the arch bridge. V9 for the Zonian fringe | blocks | `ciudad` P1 (arch bridge), P6 (locks), `corte` (road + rail run along the bank, see above) |
| `ciudad` | `city-core` west of x 2900, `pacific-locks` east half | ANCHORs `plaza-de-la-punta` P1 and `plaza-mayor-catedral` P2 (Casco, fragment `casco-viejo` measured: 389 buildings, 610/km2, 22.5 % footprint cover, OSM sparse); FILL P3-P7, `mi-pueblito` (R3), `avenida-central` P11 (`el-chorrillo` fragment not measured), `albrook` terminal (not measured), `isla-del-fuerte` P12 on the causeway islands (satellite, P12). V1 pastel Casco blocks, V3 Chorrillo walk-ups, V11 ships in the bay | blocks (Act 2 will promote it) | `ribera` P1/P6, `corredor` P2/P3/P4, `corte` none |
| **`corredor`** | `tito-corridor`, `airport`, `costa-del-este`, the east bayfront of `city-core` | Act 1: `tito-home`, `corridor-market`, `miguelito-hills`, `passenger-terminal`, `cargo-terminal`; ANCHOR `metro-linea-2` P13 (viaduct skeleton); grey tier: `torre-helice` P8, `plaza-del-sol` P10, `punta-vela` P9, Panamá Viejo ruins (fragment `panama-viejo-ruins` measured: 127 buildings, 199/km2), Costa del Este (fragment `costa-del-este` measured but OSM-sparse: 69 buildings, 108/km2, p50 7 / p90 42 levels, towers 53-245 m), `gated-community`; **the airport hiking trail (8.3, proposed)**. V4/V5/V6/V7/V12 | **full inside the Act 1 rect + margin (8.47 km2 [E]: 2409+240 by 2958+240), blocks elsewhere (about 3.7 km2 [E])** | `ciudad` P2/P3/P4, `lago` P5, `cordillera` none, `corte` the Transístmica graze |
| `cordillera` | `jungle-ridge` | `ridge-overlook` (authored (4300, 4300)), `caribbean-cove` with the ruined-fort adaptation `bahia-del-cristo` P28 (fragment `portobelo-bahia` measured: 498 buildings, 781/km2, 10.8 % cover), the range; **no road, rail or metro crosses any of its borders** (**[M*]**: only rivers cross). **Decision 3: jungle backdrop for now**; `ridge-overlook` is placed by rule if ever needed | silhouette | all borders are wilderness; Q3 ANSWERED |
| sea shell (global) | `sea` | anchored ships V11, `isla-lejana` P29 (Taboga adaptation) as horizon sprite, `perlas` dropped | impostors | resident always |

Tower strip and Pacífica anchors (P8 (3294, 1243), P9, P10, `firm-tower`, `valeria-penthouse`, Panamá Viejo (3900, 1020)) all fall in `corredor` because the Act 1
rect starts at x 3588 **[M]** (orchestrator 2026-11-25; was 3056 before the airport grading) and a sector cannot be smaller than the rect. They are grey-tier there. Splitting them off is impossible without chopping the rect (Q1).

## 2. Portals: tunnels and bridges as load masks

Today there are **2 bridge landmarks and 0 tunnels** (AUD s5): `arch-bridge` (1300, 400) and `cable-bridge` (1262, 3300), markers only, no deck, no tunnel mesh; roads cross water only as
cost multipliers (`roads.bridge 25`, `sea_bridge 250`, `canal_bridge 120`, `world.yaml`).

### 2.1 What a load mask must do

The expensive part (generate + upload the next sector) runs in a worker **before** the player reaches the portal (section 3). The mask only has to hide what the player could *see change*:
sector geometry appearing/disappearing, far silhouettes switching tier, fog colour. One formula sizes every portal:

`L >= v_floor x (T_visible_swap + T_margin)`

with `T_visible_swap` = frames between "old sector hidden" and "new sector shown" (double-buffered: 1-2 frames, **[P]**), `T_margin` = 3 s **[P]** for worker jitter, and `v_floor` = the slowest speed the
portal lets a body have (cars: a minimum cruise speed **[P]** 12 m/s; foot: 1.1-1.6 m/s is the pedestrian speed band in `world.yaml` `population.pedestrians.speed`, Tito's walk/run live in
`src/sim/locomotion.ts` tuning, not read). If the worker is NOT done when the player arrives, the portal **holds** the player (queue, lock cycle, train) instead of showing a pop: the mask length is the
fallback, the prefetch distance (section 3.3) is the real defence. `T_build` and `T_upload` per sector are **to-measure** (card 0); the only anchors are 5.99 s for the whole-isthmus generation (AUD s7 `game-probe`, 6.0 s on this run) and 0.26 s
(61 + 197 ms **[M*]**) for the Act 1 streets + city.

### 2.2 Typology

| Type | How it hides the swap | Constraint it puts on the player | Length **[P]** | Gameplay role | Real inspiration (adapted; TSV = `real-crossings.tsv`) |
|---|---|---|---|---|---|
| **A. Viaduct / long straight bridge** | Deck walls + curvature of the approach + a **fog-far ramp** 3500 -> 700 m over 3 s and back (the renderer already has fog 250-3500 m, `view.ts:35`); the camera is held on the deck axis; cars cannot stop (jersey barriers, no lay-bys) | speed floor 12 m/s for cars; on foot the deck is a 1.6 m/s walkway so use only the sidewalk-free viaduct for vehicles | 500-700 m (40-60 s at 12 m/s) | chases (arch-bridge "ship passing underneath" signature moment, districts.md), the main road/metro hand-off between sectors | Cinta Costera / Corredor viaducts; TSV: Corredor Norte 37 bridge ways, Vía Centenario 22, Corredor Sur 22, Av. Balboa Viaducto 14, Línea 1 46 and Línea 2 31 elevated ways (the metro is largely a viaduct) |
| **B. Cutting / road tunnel** | The terrain itself occludes the view (rock cut walls, then a roofed section); the camera lowers and the roof fades in (top-down game: roof = cutaway layer) | none beyond a lane; can be walked | 400-900 m | ambush spots, chases, the "road simply stops at green" feel (V10) | TSV tunnel ways: Vía Centenario (motorway), Carretera Madden (primary), Corredor Sur (motorway), Av. Israel (6), Av. de los Mártires (trunk) |
| **C. Locks / ferry (water gate)** | **Time mask**: the lock cycle (gates close, chamber fills) is a scripted wait of 60-90 s **[P]** (real chambers 305 x 34 m, `04-canal-lake-locks.md`; real cycle is minutes, compressed); a launch or ferry crossing plays the same role | forced wait; boats and visitors on the lock-gate walkway | chamber 305 m + approach reaches | the one portal that is a **place**: Neto's Atlantic locks, Miraflores visitor centre; ships keep moving | Miraflores and Gatún locks; TSV has no lock ways (water gate, not road) |
| **D. Rail tunnel (train)** | Camera on rails, input limited to look-around; a scripted ride is a pure time mask and can be skipped or cut once the swap is done | none (train speed 20 m/s **[P]**) | 900-1200 m (45-60 s) | the Interoceanic railway (`ferrocarril`, `railroad`), fast-travel feel | TSV: Vía Ferroviaria Panamá-Colón tunnel (9.006, -79.594), Línea 1 / Línea 3 subway tunnels |
| **E. Causeway** | **Weakest mask** (sea on both sides, long sight lines): it is only used toward the always-resident sea shell, i.e. to reach a *satellite* (island) sub-sector of < 0.5 km2 that loads additively while the player is already on a 700 m raised road | speed floor 12 m/s | 700 m | Amador-style island hub (cruise berth, marinas) | Amador causeway; `world.yaml` `routes.causeway` [1350,450]->[1600,200]; `sea_bridge: 250` cost |

Type A on foot is not viable (a 600 m walk is 6 minutes); on-foot crossings use type B (short, 100-300 m, a stair/escalator gate) or C.

**Decision 4 (2026-11-25) re-reads this table:** the "constraint on the player" column (speed floor, held camera, fog ramp, 60-90 s lock cycle, scripted train ride) is no longer the design. It is the **fallback** of 3.3, used only for the cases 8.3 lists. A lock is kept as a *place* (visitor centre, ships), not as a mandatory wait; the rail tunnel is a place to ride, not a loading screen; the viaduct fog ramp (3500 -> 700 m) is off by default **[P]**.

### 2.3 Portals and where they sit

All (x, y) are **[P]** proposals; the "measured" column is the real crossing found by the Node probe on the generated map **[M*]** at the candidate border (a crossing = a road, rail, metro track or the canal polyline changing sector).

| id | Name | Type | Between | Proposed x, y | Measured evidence at the border | Notes |
|---|---|---|---|---|---|---|
| P1 | `puente-del-arco` | A | `ribera` / `ciudad` | (1190, 1060) | interamericana (1188, 1060), gamboa-road (1178, 1068), Línea 2 (1190, 1062) cross the canal there | **Q2 ANSWERED: the `arch-bridge` landmark follows this generated crossing, placed by rule (8.2)**; the authored (1300, 400) is 650 m away and is ignored. Canal is 110 m wide there [M, validate/`procedural.canal.width`] |
| P2 | `viaducto-de-la-bahia` | A | `ciudad` / `corredor` | (2900, 940), spanning x 2650-3150 | interamericana (2907, 939), gamboa-road (2894, 933), coastal-avenue (2901, 936), Línea 2 (2901, 936), river w18 (2899, 1001); border height <= 38 m | one bundle of 4 roads + 1 metro + a river mouth, 65 m wide: a single portal. **Primary link from Act 1 to the rest** |
| P3 | `tunel-del-metro` | B | `ciudad` / `corredor` | (2902, 1963) | Línea 1 and Línea 3 tracks (2902, 1963) | flat plain (< 40 m): a cut-and-cover tunnel with a hard camera cut to a station; on foot |
| P4 | `paso-de-la-transistmica` | B | `ciudad` / `corredor` | (2893, 2182) | Transístmica + `ferrocarril` track (2893, 2182) | the highway hand-off, 220 m from P3: Q1 whether P3/P4 merge |
| P5 | `portillo-del-lago` | B (cutting, 120-195 m of ridge) | `corredor` / `lago` | (3028, 3953) | Transístmica + `ferrocarril` (3028, 3953) single crossing; border height up to 195 m @ (2900, 3770) | gate to the east-shore road; the Transístmica then stays in `lago` |
| P6 | `esclusas-del-pacifico` | C | `ribera` / `ciudad` | (1400, 1500) | generated Pacific lock at (1400, 1500); canal x 1351 at y 1473 | 2 chambers (`steps 2`); lock walkway = on-foot link to the visitor centre |
| P7 | `tunel-del-corte` | D | `corte` / `lago` | (1550, 3155) | `railroad` (1550, 3155), gamboa-road (1178, 3156); the seam is the divide, dry height 80-238 m (max 238 @ (380, 3150)) | the one natural ridge between the Pacific side and the lake |
| P8 | `corte-de-culebra` | B (open cut, canal) | `corte` / `lago` | (1599, 3146) | canal centreline (1599, 3146) | ships through a gorge; the cut walls are the mask |
| P9 | `esclusas-atlanticas` | C | `lago` / `limon` | (990, 6450) | generated Atlantic lock (990, 6450); canal crosses y 6500 at (963, 6492) | 3 chambers (`steps 3`); the dam is the border |
| P10 | `calzada-de-la-presa` | E (over the lake arm) | `lago` / `limon` | (1485, 6500) | Transístmica + `railroad` + `ferrocarril` (1485, 6500); lake/canal tip at (1500, 6480) | rivers w17 (1428, 6500), w15 (1009, 6504) cross too (water, not portals) |
| P11 | `calzada-amador` | E (satellite) | `ciudad` / `amador` (sub-sector) | route [1350,450]->[1600,200] | authored `routes.causeway` only; the generated roads do not build it (sea crossing is refused, section 5 trial 3) | tiny island hub, additive load; optional |
| P12 | `tunel-de-la-sierra` | B | `corredor` / `cordillera` | (4300, 3950) | **no road crosses**; only river w13 (4300, 3949); border height up to 275 m @ (5280, 3950) | **optional, Act 6**: the cordillera is a backdrop until the director wants it (Q3) |

Border crossing census **[M*]** (roads, rails, metro, canal; rivers >= 8 m wide listed separately):

| Border | Crossings (x, y) | Portals covering them |
|---|---|---|
| `ciudad` / `corredor` (x 2900) | 4 roads + Línea 2 at y 933-939; Línea 1/3 at y 1963; Transístmica + `ferrocarril` at y 2182; rivers at y 1001, 1398 | P2, P3, P4 (rivers: no portal) |
| `ciudad` / `ribera` (canal) | interamericana, gamboa-road, Línea 2 at (1178-1190, 1060-1068) | P1, P6 |
| `ciudad` / `corte` (y 2400) | canal (1449, 2397), Transístmica + `ferrocarril` (2445, 2400), river (2115, 2395) | none designed: **the canal and Transístmica cross a flat 60 m seam**: either shift the border or add a portal (Q1) |
| `corte` / `ribera` (y 2400) | gamboa-road (1250, 2404), railroad (1260, 2400), river (1398, 2397) | none designed: the road/rail run on the west bank, same issue |
| `corte` / `lago` (y 3150) | canal (1599, 3146), railroad (1550, 3155), gamboa-road (1178, 3156) | P7, P8 |
| `corredor` / `lago` | Transístmica + `ferrocarril` (3028, 3953) | P5 |
| `corredor` / `corte` | Transístmica + `ferrocarril` (2900, 3125), 85 m from the `corte` corner | covered by P5's guard tolerance or one extra stub |
| `lago` / `limon` (y 6500) | canal (963, 6492), Transístmica + `railroad` + `ferrocarril` (1485, 6500), rivers (1428, 6500), (1009, 6504) | P9, P10 |
| `corredor` / `cordillera`, `lago` / `cordillera`, `limon` / `cordillera` | rivers only | P12 optional |

Two of those borders (`ciudad`/`corte`, `corte`/`ribera`) leave roads with no designed portal: the partition is not final until Q1 is answered. The guard `portals-connect-adjacent-sectors` (section 5) would report exactly these.

### 2.4 Portals that connect the Act 1 sector to the rest

`corredor` borders `ciudad` (x 2900, y 0-2400: P2, P3, P4), `lago` and `corte` at its north-west corner (P5), and `cordillera` (P12, optional).

**ANSWERED (Q5, decision 5): there are NO closed portal stubs in Act 1** (the stub design is withdrawn). In Act 1 the sector borders are invisible data: no gate mesh, no trigger, no stub. Tito is kept inside by the existing
`playable_boundary` (`world.yaml`, the Act 1 strip) and the other six sectors are never made resident (they exist only as map raster, tiers M1/M2 of 8.5, and as the far silhouette of the always-on shell). What the player sees of "the rest of the
world" in Act 1 is the **map**: sharp near the player and blurred with distance (8.5). Portal **runtime** (cards 6+) is built only when the act that first crosses a border needs it (CLAUDE.md rules 3-4); the sector table and the portal ids stay as data so the guards of section 5 can check them.
The "portal as a load mask" idea of 2.1/2.2 is demoted: portals are **geometry that hides a tier promotion** (deck walls, tunnel mouth), and a control mechanic is added only where 3.3 / 8.3 show it is needed.

## 3. Sector lifecycle and memory budget

### 3.1 States

| State | What is resident | Draw? | Physics? | Entities? |
|---|---|---|---|---|
| `unloaded` | nothing (the 10.6 MB baked blob and the 2D map layers stay; section 4) | no | no | no |
| `prefetch` | slice arrays + generated street/building data in the worker; GPU buffers uploaded but the group `visible = false` | no | no | no |
| `active` | full set for its tier | yes | colliders + body | peds, traffic, triggers |
| `retiring` | meshes still in the scene (needed to cover the exit), colliders and entities already removed | yes, far tier | no | no |

Transitions: `unloaded -> prefetch` when the focus is within `prefetch_radius` of the shared border (portal or seamless seam) of that sector; `prefetch -> active` at the swap frame (3.3 step 4); `active -> retiring` at the same frame for the sector being left;
`retiring -> unloaded` after the hysteresis hold of 3.3 step 5 (was: when the portal's mask ends) (geometry `dispose()`d, colliders removed, arrays released). **Resident cap N = 3** **[P]**: 1 active + 1 prefetch + 1 retiring, plus the global sea shell. No allocation during play inside an active sector
beyond pools (PS2 rule).

### 3.2 Budget table (fixed per tier; fill the unknowns after card 0)

**Card-0 baseline, measured [M]** (`tools/capture.mjs`, headless Chrome on Metal, 1280x720, 2026-11-25 after the airport grading; heap = Chrome `performance.memory` in MB, JS heap limit 4192 MB):

| View | FPS | Tris | Draws | Entities | JS heap used / total |
|---|---|---|---|---|---|
| Play at `tito-home` | 60 | 686.6k | 23 | 43 (40 pedestrians) | 97.2 / 137.7 |
| Debug overview (`?debug`) | 60 | 418.0k | 7 | | 90.6 / 137.0 |
| Airport (spawn `passenger-terminal`) | 60 | 666.2k | 12 | 3 | 66.3 / 132.5 |

Console, same session **[M]**: street edges 516, blocks 55, buildings 1200, walkGraph nodes 594 / edges 810; isthmus decoded in 28 ms, Act 1 world generated in 195 ms; near ground 126,780 tris built in 173 ms; Rapier colliders 1746 (1200 buildings, 8 wall segments, heightfield 526 x 823 cells of 4 m); minimap / world-map base baked in 223 ms.
**Still unmeasured**: GPU memory, the Rapier WASM heap and frame p99 (headless Metal is not the director's GPU, and 60 FPS is vsync-capped, so headroom is unknown).
**Honest implication**: today's JS heap (66-97 MB used of a 4192 MB limit) is small, so sector unloading is not about being near the limit now. It is about future detail growth, GPU and WASM memory (unmeasured) and load hitches (decode 28 ms, world build 195 ms, near ground 173 ms are all on the main thread today).

Baselines that exist today (a real headless capture of `?play&spawn=passenger-terminal` on 2026-11-25 **[M]**, game console: 516 street edges, 1200 buildings, 126,780 near-ground triangles, 1746 colliders = 1200 buildings + 8 wall segments + heightfield 526 x 823 cells of 4 m + others not itemised, 666.2k tris and 12 draws in the play view; these are now baseline candidates for card 0, JS heap is now measured (66-97 MB used, see 3.2); GPU memory, WASM heap and frame p99 are still unmeasured): overview 760.7k tris / 32 draws / 60 FPS (vsync-capped, headroom unknown) **[M]** AUD s4; near ground 161,417 tris, x2 with the depth prepass **[M]** AUD s4 (that run predates the saved edits and the airport grading, so the map differs; the 2026-11-25 capture above gives 126,780 **[M]**); 1,160
buildings / 612 street edges **[M*]** for the stale 7.13 km2 rect (516 / 1200 in the 2026-11-25 capture **[M]**; the new 5.68 km2 rect is not re-measured); 40 pedestrians max (`budget`, `world.yaml`); one 4 m heightfield collider + 1 cuboid per building + walls <= 20 m **[M]** code reading; count **[M]** 1746 colliders in the 2026-11-25 capture (1200 buildings, 8 wall segments, heightfield 526x823 cells of 4 m);
terrain far grid 16 m over the whole box = 376 x 501 = 188k f32, ~0.75 MB **[E]**. The #11 plan's targets: overview <= 400k tris, <= 40 draws, <= 8 ms GPU frame **[P]** (`.claude/orchestrator/runs/2026-11-24-pendientes-guardas-y-lod.md`).

| Budget | `full` tier (Act 1 rect + margin) | `blocks` tier (grey blocks) | `silhouette` tier | Global shell | How to measure the baseline |
|---|---|---|---|---|---|
| Triangles drawn (incl. prepass) | <= the measured Act 1 value **[P]**: cap = measured x 1.0; today 686.6k play view at `tito-home` / 418.0k `?debug` overview **[M]**; 323k near ground **[M]** (stale map; 2026-11-25 capture: 126,780 near ground, 666.2k tris and 12 draws in the play view **[M]**) | <= 25 % of full **[P]** | <= 10 % of full **[P]** | <= 5k **[P]** | `renderer.info.render.triangles` (HUD `debug-hud.ts:40` already reads `info.render`), `tools/capture.mjs` |
| Draw calls | <= 24 **[P]** (23 at `tito-home`, 12 at the airport, 7 in `?debug` **[M]**) | <= 6 **[P]** | <= 2 **[P]** | <= 3 | `renderer.info.render.calls` |
| Whole-frame ceiling | all resident sectors together <= 400k tris, <= 40 draws **[P]** (same as #11) | | | | same |
| JS heap MB | **97.2 used / 137.7 total (play at tito-home), 66.3 / 132.5 (airport) [M]**; per-tier split still to-measure | **to-measure** | **to-measure** | 90.6 / 137.0 whole-map overview (`?debug`) **[M]** | `performance.memory.usedJSHeapSize` (Chrome only, coarse) or `performance.measureUserAgentSpecificMemory()` (needs cross-origin isolation headers); sample before/after each stage with a forced GC in a probe |
| GPU MB | **to-measure** | **to-measure** | **to-measure** | **to-measure** | `renderer.info.memory.geometries/textures` gives counts, **not bytes**; bytes = sum over geometries of `attribute.array.byteLength` + index (a probe function, card 0). Rough floor **[E]**: 161k tris, ~0.5 vertices/tri, 36 B/vertex (pos+normal+colour) + Uint32 index ~ 5 MB for the Act 1 near ground; no textures exist (AUD s2) |
| Rapier colliders | **1746 [M]** (2026-11-25 headless capture of `?play&spawn=passenger-terminal`: 1200 buildings, 8 wall segments, heightfield 526x823 cells of 4 m); baseline candidate, re-measure in card 0 | 0 | 0 | 0 | `world.colliders.len()` after setup |
| Rapier WASM heap | **to-measure** (not captured in the 2026-11-25 baseline) | | | | `rapier.wasm` memory `buffer.byteLength` before/after |
| Entities | peds <= 40 (`population.pedestrians.budget`) + traffic **to-measure** (no traffic exists) | 0 | 0 | ships <= 25 impostors **[P]** (V11 says 15-25) | `ecs` entity count in HUD |
| Build time worker `T_build` | **to-measure** | **to-measure** | **to-measure** | | `performance.now()` around the worker job; Node proxies today: 6.0 s whole isthmus, 0.26 s Act 1 streets + city **[M*]** |
| Upload `T_upload` | **to-measure** | | | | `performance.now()` around `renderer.compile`/first render of the new group |
| Per-sector slice bytes | see 1.2 (0.5-2.7 MB each **[E]**) | | | | codec length per section, card 3 |

### 3.3 Seamless transitions: prefetch distance, worker generation, hidden swap (decision 4)

**Design goal: the player never perceives a transition.** Mechanisms come in this order; a control mechanic (fog ramp, speed floor, lock, hold) is allowed only if a step cannot be met (list in 8.3).

1. **Prefetch by distance, not by trigger.** `D_prefetch = v_max x (T_build + T_upload + T_margin)`, measured along the way to the border. `v_max` is now **measured from source**: `CAR.maxForward = 16 m/s` (`src/sim/vehicle.ts:38`) **[M]**; pedestrian 1.1-1.6 m/s (`world.yaml` `population.pedestrians.speed`) **[M]**; the moto's top speed is not read (use <= 30 m/s **[P]**). Worked with placeholders: `T_build + T_upload` 4 s **[P]** + margin 3 s -> 16 x 7 = **112 m** (car), 210 m for the 30 m/s assumption **[E]**. The proposed `procedural.sectors.prefetch_radius` of 1200 m (section 5) gives 75 s of warning at car top speed and 750 s on foot **[E]**, i.e. a >= 10x margin even if `T_build` is ten times the placeholder. The previous example used 30 m/s for the car: that was wrong (stale), superseded by 16 m/s. Debug fly (`FLY.maxSpeed = 2000 m/s`, `src/sim/debug-fly.ts:33`) **[M]** and teleports are the only movers faster than the prefetch margin: see 8.3.
2. **Generation in a worker, one job at a time.** The worker decodes the bake once, slices (`sliceIsthmus`), generates streets/buildings/drape for the target sector and posts transferable typed arrays (3.4). Main-thread work per swap is only `BufferGeometry` wrapping + Rapier colliders. Node proxy for the Act 1 job: 0.26 s streets + city, 6.0 s whole isthmus **[M*]**; browser `T_build` and `T_upload` are **to-measure** (card 0).
3. **Progressive tiers, so the border is crossed already looking right.** Every non-resident sector is always drawn at the `silhouette` tier (card 8, ties to #11), and a sector inside `prefetch_radius` is promoted in the background to `blocks`, then to its full tier. The player therefore never sees an empty region: they see a coarser one that gets finer. **[P]**
4. **Double-buffered swap behind geometry or distance.** A tier promotion is built `visible = false` and flipped in one frame (old disposed one frame later). It is hidden when at least one holds: (a) the changed region is outside the camera footprint (distance > camera view radius, **to-measure**; fog already covers 250-3500 m `view.ts:35`); (b) portal geometry occludes it (viaduct deck walls, tunnel mouth: the portal types of 2.2 keep this role, **without** controls); (c) a 6-12 frame dithered cross-fade of the promoted layer **[P]**. The border itself needs no visible event: colliders and entities swap at the same frame, and the HUD/camera are untouched.
5. **Hysteresis against ping-pong.** A retired sector stays resident (`retiring`, entities removed) for >= 30 s **[P]** and the resident cap N = 3 holds; crossing back before that costs nothing. P3 and P4 are 220 m apart, so this matters there.
6. **Fallback (only if step 1 is missed):** hold the player at the border (see 2.1) rather than show a pop; with the margins above this should never trigger and card 6 logs it as an error.

### 3.4 Techniques (the PS2 list, mapped to this stack)

| Technique | Use here | Status today |
|---|---|---|
| Fixed pools | pedestrian `InstancedMesh` capacity 40 and per-sector entity pools; no `new` during play | peds already pooled (`pedestrians.ts:58-67`) |
| Instancing | buildings per sector stay ONE `InstancedMesh` (`meshes.ts:371-398`), 12 tris each; far tier uses block-merged boxes instead of per-building | one global instance mesh today |
| One merged mesh per sector and layer group | replace the single merged near ground (`world-view.ts:163-230`) by one per sector; frustum culling then works per sector | merged but one for the whole rect |
| Texture atlas | none needed yet: everything is vertex colour (AUD s2). If textures appear (Casco pastel facades, V1) they go in ONE atlas per tier, shared by all sectors, never per-sector textures | no textures |
| Typed arrays + transferable buffers | the worker returns `Float32Array`/`Uint32Array` with `postMessage(buf, [buf.buffer])`; the main thread wraps them in `BufferGeometry` without a copy | codec already uses aligned typed arrays (`isthmus-codec.ts:73-80`) |
| Worker generation | street graph, blocks, buildings, drape and colliders' source arrays are computed in a Web Worker per sector; main thread only builds `BufferGeometry` and Rapier colliders | everything on the main thread (AUD s1, no worker) |
| Double-buffered swap | build the next sector's group `visible = false`, then flip `visible` in the same frame the old one is hidden; dispose the old one one frame later | does not exist |
| Deterministic teardown | one `Scope` object per sector owns every geometry, material, collider handle, entity and listener; `scope.dispose()` is the only exit | there is no teardown anywhere (AUD s2: no `geometry.dispose`, `material.dispose`, `scene.remove`, `removeCollider`) |
| Shared materials | one material per class (landmarks currently create 2 `MeshStandardMaterial` per object, `meshes.ts:404-421`) | per-object |

## 4. What must change in the code

Smallest change per component; paths from AUD (line numbers are AUD's, re-verified: `src/ecs/plugin.ts:23-27` has `setup` only; `grep` for `dispose(|scene.remove|removeCollider` in `src/` outside `ui/` finds only `view.dispose()`, `input.dispose()`).

| Component | File | Smallest change | Depends on |
|---|---|---|---|
| Plugin teardown/create contract | `src/ecs/plugin.ts:23-27` | add optional `dispose?(ctx): void` and `onSector?(ctx, event: {id, phase})`; add a `Scope` helper (`own(x)`, `dispose()`) in a new `src/ecs/scope.ts` | none |
| Plugin loop | `src/engine/game.ts:41-48,85-86` | keep the setup order, run `dispose` in reverse order on stop; expose a sector manager service | plugin contract |
| World data | `src/plugins/world-data.ts`, `src/world/world-data.ts:43-56` | `buildWorldData(raw, iso)` -> `buildSectorData(raw, iso, sector)`: same pipeline but the rect is the sector's full-tier rect; keep a small **skeleton** (coast, canal, roads, lake, districts) for the whole isthmus for maps and minimap | sector table |
| Sector table (pure) | new `src/world/sectors.ts` | `SECTORS` (polygons, tier, neighbours), `sectorOf(x, y)`, `portalsOf(id)`; plus a pure `sliceIsthmus(iso, sector)` | none |
| Per-sector slices of the bake | `src/world/proc/isthmus-codec.ts` | **do not change the format first**: the blob is 10.6 MB; keep one fetch + one decode (already a transient 2x copy, AUD s7) **inside the worker**, then `sliceIsthmus` copies sub-rects (cells row/col sub-arrays) and posts them as transferables. Add per-region sections to the codec only if the decode time or the transient copy proves a problem (card 0 will tell) | worker |
| Worker | new `src/world/sector-worker.ts` | runs decode + `sliceIsthmus` + streets/city/drape for one sector and returns transferable arrays | codec, sector table |
| Per-sector meshes | `src/plugins/world-view.ts:105-253`, `src/engine/meshes.ts` | split into `buildSectorView(slice, tier) -> {group, scope}`; far strips (`:118-139`) become the `blocks`/`silhouette` tier of each sector; landmark markers share materials | scope, worker |
| Per-sector physics | `src/plugins/world-physics.ts:14-70` | one `RigidBody` per sector (created in `prefetch`, enabled in `active`); `world.removeRigidBody(body)` frees all its colliders; the 4 m heightfield only for `full` tier; walls cut per sector | scope |
| Pedestrians/focus | `src/plugins/pedestrians.ts:17-27,158-162` | already create/destroy by distance; add: despawn all on sector retire, spawn ring constrained to the active sector | sector manager |
| Far-sector LOD (#11) | `src/plugins/debug-mode.ts:22-23,58-93`, issue #11 plan L2-L4 | #11's far terrain tiles (96/192/384 m with skirts) are the `silhouette` tier of every non-active sector; debug mode then draws far tier only (cost ~ the 400k target) instead of widening fog/far over the full ground (AUD s3: today it draws everything every frame, 760.7k tris) | sector table, per-sector meshes |
| 2D maps (decision 5) | `src/ui/map-base.ts`, `src/ui/world-map-canvas.ts`, `src/ui/minimap-layer.ts`, `src/plugins/world-map.ts`, `src/plugins/minimap.ts`, `src/sim/map-view.ts` (pure tier function) | **tiered, per-sector raster instead of one resident raster** (8.5): M2 whole isthmus always, M1 per sector, M0 only for the resident sector, blur by distance from the player; canvas bytes are **to-measure**, arithmetic estimate in 8.5 | sector table |
| Seamless streaming runtime | new `src/plugins/sector-manager.ts` (card 5) | prefetch by distance, tier promotion, double-buffered swap, hysteresis (3.3). Fog ramp / speed floor / hold only as the fallbacks of 8.3 | worker, sector table |
| Portal runtime (deferred) | new `src/plugins/portals.ts` | portal geometry (deck, tunnel mouth) and, only where 8.3 requires it, the control mechanic; **not built in Act 1** | sector manager, an act that crosses a border |
| Airport grading (8.4) | `src/world/proc/airport.ts`, `src/world/proc/isthmus.ts:141` | replace the fixed 150 m smoothstep blend with slope-limited cut/fill grading; **not implemented** | none |
| Trail + rule placement (8.2, 8.3) | `src/world/proc/landmarks.ts`, `src/world/proc/roads.ts`/new `trails.ts`, `src/world/spec.ts` | new landmark rule `crossing`; new `procedural.trails`; `trail` walkable class | none |
| Studio params/guards | `src/studio/{params,guards,presets}.ts`, `src/world/spec.ts` | section 5 | none (offline) |

Do **not** change: `world.yaml` districts/grid (budget only), the Act 1 `slice`/`streets`/`city` algorithms, `isthmus-codec.ts` format (first pass), the Rapier version.

### 4.1 Teardown contract **[M]** (as implemented, card 6 minimal slice)

- `src/ecs/scope.ts` (pure): `createScope()` -> `{ own(x), dispose(), live }`. `own` takes `{dispose()}` or `() => void`, returns `x`. `dispose()` runs in reverse order, once (idempotent), keeps going when a disposer throws, then throws one `AggregateError` with every failure. `own` on an already-disposed scope disposes `x` at once. `live` = owned and not yet disposed.
- `createPluginScopes()`: one Scope per plugin; `disposeAll()` in reverse registration order.
- `GameContext.own`: during `setup` it is backed by that plugin's Scope (`game.ts` passes `{ ...ctx, own }`). Plugins that never call it behave as before. Not an `onSector` hook yet: sector events (card 6 proper) will call the same scopes per sector.
- `game.disposePlugins()` disposes every plugin scope; `game.stop()` calls it first, then input/view. Both log `[teardown] live owned: N` (before, then 0 after).
- `src/engine/dispose-object.ts`: `ownSceneAdditions(scene, own, build)` snapshots `scene.children`, runs `build`, and owns every child added (even if `build` throws): `scene.remove`, `geometry.dispose()`, `material.dispose()` and every texture held by a material. `world-view` uses it around its unchanged build code and owns its label layer; `world-physics` owns `world.removeRigidBody(body)` (removes every attached collider).
- NOT covered yet: the Rapier `World` itself (`createPhysics` has no `free()`), pedestrians pool, minimap/world-map canvases and textures, `debug-mode` wheel listener and other `window` listeners, `engine/meshes.ts` module-level shared materials/geometries (if any), other plugins' HUD DOM. Each adopts `ctx.own` when it becomes sector-scoped.
- Guards: `tests/teardown.test.ts` (fake three objects counted; real Rapier collider count 0 after dispose; source-wiring check because world-view needs WebGPU/DOM). Mutation-checked: reverse order, idempotence, skipped own, skipped texture disposal, skipped body removal, unwired world-view, stop without dispose all go red.

## 5. Map Studio integration

Map Studio edits the **procedural isthmus** (`procedural:` section); sectors and portals are macro structure over it, so they belong there as a new group, read by the bake and by the guards. Nothing below exists yet; the parser (`src/world/spec.ts`) is strict.

### 5.1 Proposed controls (all **[P]**)

| Path | Type / unit | Range | Default | Meaning |
|---|---|---|---|---|
| `procedural.sectors.resident_max` | integer | 2-4 | 3 | max resident sectors (active + prefetch + retiring) |
| `procedural.sectors.prefetch_radius` | m | 300-3000 | 1200 | distance to a portal at which a neighbour starts building |
| `procedural.sectors.act1_margin` | m | 100-600 | 120 | extra around the derived Act 1 rect that must lie inside the Act 1 sector (equals `relief.grid.margin`) |
| `procedural.sectors.items[id].polygon` | list of points, m | 4-12 vertices | the 7 borders of 1.2 | sector border; seam-following |
| `procedural.sectors.items[id].tier` | `full` \| `blocks` \| `silhouette` | | `corredor` full-in-rect + blocks, others per 1.3 | detail tier |
| `procedural.sectors.items[id].act1` | boolean | | `corredor` true | the sector that must contain the Act 1 rect |
| `procedural.portals.items[id].kind` | `viaduct` \| `tunnel` \| `locks` \| `rail-tunnel` \| `causeway` | | per 2.3 | type |
| `procedural.portals.items[id].on` | `{route|line|canal, border: "a|b"}` | | per 2.3 | **rule placement**: the crossing of that route over that border (never raw x, y, per correction 2) |
| `procedural.portals.items[id].length` | m | 60-1500 | viaduct 500, tunnel 600, locks 320, rail-tunnel 1000, causeway 700 | geometry length (occlusion), no longer a mask duration (decision 4) |
| `procedural.portals.items[id].control` | `none` \| `speed_floor` \| `hold` | | `none` everywhere (decision 4) | **fallback only**; replaces the always-on controls below |
| `procedural.portals.items[id].speed_floor` | m/s | 1-40 | unused when `control: none`; fallback value viaduct/causeway 12 | slowest allowed speed |
| `procedural.portals.items[id].fog_far` | m | 300-3500 | unused when `control: none`; fallback 700 | fog far during a fallback hold |
| `procedural.portals.build_budget_s` | s | 1-30 | **to-measure** | T_build ceiling for a sector job |
| `procedural.sectors.items[id].seam` | `portal` \| `seamless` | | `seamless` for `ciudad`/`corte` and `corte`/`ribera` (decision 1+4) | border with no portal geometry |
| `procedural.landmarks.<id>` rule `{ crossing: { route, with } }` | landmark rule | | `arch-bridge: { crossing: { route: interamericana, with: canal } }` | rule placement on a generated crossing (8.2) |
| `procedural.trails[id]` **[M, card 3, 2026-11-25]** | `{ from: airport-terminal, to: { highest_within, margin, min_distance }, width, max_grade, min_length, max_length }` | see 8.3 | `airport-ridge`: 900 / 120 / 700 m, 1.2 m, 0.30, 1000-1500 m | the hiking trail (8.3); built as a list by `id` (not `items`): `src/world/spec.ts`, `specs/map/README.md`, `src/studio/params.ts` |
| `procedural.airport.grading` | `{ cut_slope, fill_slope, bench_every, wall_max, smooth_passes }` | see 8.4 | cut 0.5, fill 0.33, bench 10 m, wall <= 12 m, 2 passes **[P]** | airport earthworks (8.4) |
| `procedural.map_lod.tiers` | `[{ id, m_per_px, blur_px, max_range_m }]` | see 8.5 | M0 1 / 0, M1 6 / 1.5, M2 24 / 4 **[P]** | world-map and minimap raster tiers |

### 5.2 Proposed guards

Each follows the existing shape (all rows, including those added on 2026-11-25, are [P] and unwritten) (`Guard = (ctx) => message | undefined`, `src/studio/guards.ts`) and needs a mutation test before it counts (CLAUDE.md, `tests/studio-guards.test.ts` pattern). None is written; the mutation each one needs is stated.

| Guard | Checks | Mutation that must turn it red (not run) |
|---|---|---|
| `sectors-cover-extent` | every 20 m cell of the 6000 x 8000 box has exactly one owner sector; no empty, no overlap | move `ciudad`'s east border from x 2900 to 2800: 0.0 km2 of overlap but a 0.1 x 2.4 km gap appears |
| `portals-connect-adjacent-sectors` | every portal sits within 120 m of the shared border of exactly two sectors; every measured road/rail/metro/canal crossing of a border has a portal within 120 m; the sector graph via portals is connected | delete P2: the 6 crossings at (2900, 933-1001) lose their portal |
| `sector-budget-estimate` | per-sector triangle/building/collider estimate from `metrics` (built km2, land cells, `towns` density) <= the tier cap; fails if the estimate exceeds it | raise `towns.items[id=el-corredor].target_km2` until the estimate passes the cap (the caps are to-measure, so this guard waits for card 0) |
| `act1-sector-contains-act1-rect` | the `gameSpecFromIsthmus` rect, grown by `act1_margin`, lies inside the `act1` sector polygon | set `corredor`'s west border to x 3600 (rect x min 3588, minus 120 = 3468; set it to 3600 to see it fail): red |
| `bridge-landmarks-on-crossing` (decision 2) | every landmark with a `crossing` rule lies within 1 cell (20 m) of the generated crossing of that route with that water; the 5 Act 1 landmarks and `canal.bridge_landmarks` all have a rule | revert `arch-bridge` to the authored (1300, 400): 650 m from the crossing at (1190, 1060), red |
| `airport-pad-floats` (decision 6, 8.4) | max height step over the blend ring <= `step_max` and max embankment slope <= `slope_max` | restore the fixed 150 m smoothstep: red on today's edits (8.4) |
| `trail-connected-and-grade` (8.3) **[IMPLEMENTED 2026-11-25, `src/studio/guards.ts`]** | the airport trail reaches both ends, never exceeds `max_grade`, never crosses the airfield, water or a built cell, and stays inside the Act 1 rect | set `max_grade` to 0.05: no route exists, red (done in `tests/trails.test.ts`; viewpoint = terminal also red) |
| `map-raster-budget` (8.5) | estimated bytes of resident map rasters (M0 of resident sectors + all M1 + M2) <= cap | set M0 to 0.25 m/px: 16x the bytes, red |

### 5.3 Existing guards the proposal would violate (by design)

| Existing guard (`src/studio/guards.ts`) | Why a portal would trip it | Resolution |
|---|---|---|
| `transport-crosses-water-only-on-bridges` | a causeway/sea viaduct modelled as a road route "runs through the open sea"; the reservoir likewise (P10) | portals are overlays, not routes: the deck is data of the portal; the route is split at the portal. Trial 3 below shows the refusal |
| `pinned-places-on-land` | a ferry, lock or bridge anchor is on water (`on_water` landmarks already exist) | portal anchors are exempt and use their own guard |
| `routes-connected` | a route cut at a sector border "does not reach its end stops" if the border is treated as the end | routes stay whole; the sector manager only cuts at load time |
| `wilderness-between-centres` (>= 60 % wilderness, now 0.907 **[M*]**) | not violated; noted because `cordillera` is its reserve |

### 5.4 What I tried (real CLI responses; `NODE_OPTIONS=--max-old-space-size=1536`, ops `inspect/validate/patch dryRun/add-district dryRun/revert` only, one at a time, 2-3 s each; never `save`, never `force`)

| # | Request | Real response (trimmed) | Result |
|---|---|---|---|
| 1 | `inspect` | `ok: true`, `edits {saved: 6, working: 6, unsaved: false}`, revision `12c2de4ba2fd23` | ok (the map is the saved edits, correction 1) |
| 2 | `patch dryRun procedural.sectors = [{id: act1, rect: [3584,573,5775,3370]}]` | `ok: false`, `errors: ["sectors: no such parameter"]` | **refused**: the parser is strict; the proposed group needs `spec.ts` + `params.ts` first |
| 3 | `validate cell 40` | `ok: true`, `violations: []`, `urbanKm2 3.27`, `lakeKm2 5`, `wildernessShare 0.907`, `airport (5099, 2778)`, `roadsConnected 5/5`, `transitConnected 6/6` | ok (baseline) |
| 4 | `patch dryRun procedural.roads.sea_bridge 250 -> 5` (a sea crossing for a causeway/viaduct) | `ok: false`, `errors: ["conflict — transport-crosses-water-only-on-bridges: interamericana runs through the open sea. The last valid state is kept."]` | **refused**: confirms 5.3, portals must be overlays |
| 5 | `patch dryRun procedural.lake.target_km2 5 -> 8` (the spec's authored lake size; the `lago` sector) | `ok: false`, `errors: ["conflict — routes-connected: route gamboa-road does not reach its end stops. ..."]`, `lakeLevelM 218.76`, 32 stations | **refused**: the lake cannot grow to its spec size without drowning Gamboa; the `lago`/`corte` seam depends on 5.00 km2 |
| 6 | `patch dryRun procedural.game.rect_margin 300 -> 600` | `ok: true`, `violations: []` | **ok, and that is the gap**: the Act 1 rect can grow past any sector border today; no guard looks (needs `act1-sector-contains-act1-rect`) |
| 7 | `patch dryRun procedural.canal.width 110 -> 200` | `ok: true`, `violations: []` | ok (a wider canal lengthens P1/P6 spans; no guard checks portal length) |
| 8 | `patch dryRun procedural.canal.width -> 400` | `ok: false`, `errors: ["procedural.canal.width: 400 is above the maximum 300 m"]` | refused by range (`params.ts`) |
| 9 | `add-district dryRun preset paitilla-pacifica-towers at [3300, 1000]` | `ok: true`, `districtsKm2 {"paitilla-pacifica-towers": 1.31}`, `violations: []` | ok: the east bayfront tower strip is placeable inside `corredor` today |
| 10 | `patch dryRun procedural.relief.zones[id=divide-west].width 750 -> 1400` | `ok: true`, `urbanKm2 3.27 -> 3.29`, `violations: []` | ok: the divide behind P7 can be reshaped with no guard noticing; a portal guard would need a ridge-height check |
| 11 | `reset` then `inspect` | `edits {saved: 6, working: 0, unsaved: true}` | note: `reset` leaves the working copy EMPTY, not the saved state |
| 12 | `revert` then `inspect` | revision `12c2de4ba2fd23`, `edits {saved: 6, working: 6, unsaved: false}` | **final state = starting state** (also `diff against base` lists the 6 saved edits) |

Not run: `preview` (no image was needed), the four proposed guards (they do not exist), any `save`.

## 6. Implementation plan (small cards)

Each card: <= 5 files, one observable outcome, a check command. Heavy checks (browser, capture) run one at a time in the main session, never by agents (user's RAM budget). **D** = needs a director decision first. Revised 2026-11-25 after the decisions of section 8; cards 1-4 are new, the old cards 1-8 are renumbered 5-12. Every new guard is mutation-checked (break, red, restore, green) before the card counts.

| # | Card | Files (<= 5) | Observable outcome | Check | D |
|---|---|---|---|---|---|
| 0 | **Baseline measurement** (stays first) | `src/plugins/debug-hud.ts`, `tools/capture.mjs`, new `tools/sector-probe.ts` (from the throw-away probes), `docs/map-reshape/03-technical/12-sectors-and-streaming.md` (fill the to-measure cells; the 2026-11-25 capture of `?play&spawn=passenger-terminal` already gives 516 edges, 1200 buildings, 126,780 near-ground tris, 1746 colliders, 666.2k tris, 12 draws **[M]**: baseline candidates; re-measure edges/buildings for the 5.68 km2 rect; JS heap measured 2026-11-25: 97.2 / 137.7 MB at `tito-home`, 90.6 / 137.0 `?debug`, 66.3 / 132.5 airport, limit 4192 MB; also 60 FPS, 686.6k / 418.0k / 666.2k tris, 23 / 7 / 12 draws, 43 entities (40 pedestrians), decode 28 ms, Act 1 world 195 ms, near ground 173 ms, minimap base 223 ms **[M]**; GPU memory, Rapier WASM heap and frame p99 still unmeasured **[done: baseline recorded in 3.2; the probe tool and HUD fields remain]**) | HUD and a JSON line report: tris, calls, geometries, geometry bytes, JS heap, collider count, WASM bytes, `T_build`, `T_upload`, frame p50/p99, **plus map canvas bytes (M0/minimap/base, 8.5) and the airport pad profile (height at 0/300/500/650 m E, W, S, 8.4)**, for `?debug` and play at spawn | `node --max-old-space-size=1536 tools/sector-probe.ts` (Node: borders, areas, crossings, Act 1 counts, pad profile); `node tools/capture.mjs` (heavy: browser) | no |
| 1 | **Airport grading** (8.4; prerequisite for the Act 1 look) **[IMPLEMENTED 2026-11-25]** | `src/world/proc/airport.ts`, `src/world/proc/isthmus.ts`, `src/studio/guards.ts`, `src/studio/params.ts`, `tests/airport-grading.test.ts` | the field no longer floats: max height step over the blend ring <= `step_max` and embankment slope <= `slope_max` on the saved edits; runways unchanged in position | `node --max-old-space-size=1536 --test --test-timeout=120000 tests/airport-grading.test.ts`; mutation: restore the 150 m smoothstep, guard `airport-pad-floats` red; restore, green; then `preview` (Studio, no save) to look | no (look confirmed by the director) |
| 2 | **Rule-based placement of `arch-bridge`** (and the other bridge/anchor landmarks) **[arch-bridge IMPLEMENTED 2026-11-25; the rest see 8.2]** | `src/world/proc/landmarks.ts`, `src/world/spec.ts`, `specs/map/world.yaml` (`procedural.landmarks`), `src/studio/guards.ts`, `tests/landmarks.test.ts` | `arch-bridge` lands within 30 m (`tolerance`) of the generated road/canal crossing near (1190, 1060); `cable-bridge`, `free-zone`, `domo-del-radar` not done (see 8.2) | `node --test` on `tests/landmarks.test.ts`; mutation: pin `arch-bridge` back to (1300, 400), guard `bridge-landmarks-on-crossing` red | no |
| 3 | **Airport hiking trail (spec + route)** (8.3) **[IMPLEMENTED 2026-11-25, spec + route only; follow-ups in 8.3]** | `specs/map/world.yaml` (`procedural.trails`), `src/world/spec.ts`, new `src/world/proc/trails.ts` (reuses `leastCostPath`), `src/studio/guards.ts`, `tests/trails.test.ts` | a >= 1 trail from the terminal side of the airport to a ridge viewpoint, walkable, not drivable | `node --test` on `tests/trails.test.ts`; mutation: `max_grade 0.05`, guard `trail-connected-and-grade` red | trail end point (N1) |
| 4 | **Map blur LOD** (8.5, answers old Q8) **[IMPLEMENTED 2026-11-25]** | `src/ui/map-base.ts`, `src/ui/world-map-canvas.ts`, `src/ui/minimap-layer.ts`, `src/sim/map-view.ts` (pure `mapTierAt(distance, mpp)`), `tests/map-lod.test.ts` | world map and minimap: sharp near the player, blur and lower detail with distance; canvas bytes within the 8.5 cap | `node --test` on `tests/map-lod.test.ts` (pure tier function); mutation: swap the M1/M2 thresholds, test red; one capture of the world map (main session) | interpretation of decision 5 (N2) |
| 5 | Sector table + pure functions | `src/world/sectors.ts`, `tests/sectors.test.ts`, `tools/sector-probe.ts` | `sectorOf` tiles 48.00 km2, the crossing clusters map to portals or `seamless` seams | `node --max-old-space-size=1536 --test --test-timeout=120000 tests/sectors.test.ts`; mutation: move a border 100 m, test red, restore | none (Q1, Q2 answered) |
| 6 | **Teardown contract** | `src/ecs/plugin.ts`, `src/ecs/scope.ts`, `src/engine/game.ts`, `src/plugins/world-view.ts`, `src/plugins/world-physics.ts` | stopping the game disposes every world geometry/material/collider: `renderer.info.memory.geometries === 0` and `world.colliders.len() === 0` after `stop()` | unit test with a fake ctx + a one-page HUD read; mutation: skip one `own()` call, count > 0 | no |
| 7 | Per-sector slice (pure) **[IMPLEMENTED 2026-11-25: `src/world/sector-slice.ts`, `tests/sector-slice.test.ts`; owned cells and bytes sum exactly to 120,000 / the whole, 1-cell apron, rect 3588-5450 x 562-3610 inside corredor, buildWorldData 516 edges / 1200 buildings unchanged]** | `src/world/sector-slice.ts` (`sliceIsthmus`, `assembleIsthmus`), `tests/sector-slice.test.ts` | slices of all 7 sectors sum to 120,000 cells and ~10.6 MB; Act 1 sector slice feeds `buildWorldData` with the same result as today (rect, 612 edges, 1,160 buildings) | node `--test`; compare with the card-0 numbers | no |
| 8 | Act 1 as sector #1: build + dispose | `src/plugins/world-view.ts`, `src/plugins/world-physics.ts`, `src/plugins/world-data.ts`, `src/world/world-data.ts` | the game plays identically (same tris/draws as card 0); `?debug` "reload Act 1 sector" key frees and rebuilds it with flat JS heap; **M0 map layer freed and rebuilt with it** | HUD + `node tools/capture.mjs`; heap after 5 reloads within +5 % of the first | no |
| 9 | **Worker generation + seamless swap** (3.3) | `src/world/sector-worker.ts`, `src/plugins/sector-manager.ts`, `src/plugins/world-view.ts` | a `blocks`-tier `ciudad` builds in a worker while Act 1 runs and is promoted with no visible pop; no frame over 2x baseline p99; the "late worker" hold counter stays 0 | capture frame log; slow the worker by 3 s: the fallback hold fires and is logged | no (waits for an act that crosses a border) |
| 10 | Studio guards for sectors and portals | `src/studio/guards.ts`, `src/studio/params.ts`, `src/world/spec.ts`, `tests/studio-guards.test.ts`, `docs/map-reshape/map-studio-agent-workflow.md` | `procedural.sectors`/`procedural.portals` accepted (with `seam: seamless`); the 4 guards of 5.2 exist; all 4 mutations red then green | `node --max-old-space-size=1536 --test --test-timeout=120000 tests/studio-guards.test.ts`; then CLI trials 2 and 6 of 5.4 behave as designed | no |
| 11 | Far-tier LOD for non-active sectors (ties to #11) | `src/plugins/world-view.ts`, `src/plugins/debug-mode.ts`, `src/engine/meshes.ts` | overview shows far tier of every sector at <= 400k tris | capture `O` view | no |
| 12 | **One portal prototype** P2 `viaducto-de-la-bahia` (deferred) | `src/plugins/portals.ts`, `src/plugins/sector-manager.ts`, `src/engine/meshes.ts` (deck + parapets), `src/plugins/debug-mode.ts`, `tests/portals.test.ts` | crossing the deck promotes `ciudad` with `control: none` and no pop | manual capture + `renderer.info.memory.geometries` before/after | **D**: only when an act crosses this border (CLAUDE.md rule 3) |

Order rationale: measure (0); fix what Act 1 shows (1-4: the airport look, rule placement, the trail, the map); define sectors as data (5); make memory reclaimable (6); slice (7); prove the Act 1 sector alone round-trips (8); only then streaming (9) and the rest (10-12). Cards 1-4 are independent of each other and of 5-12 and need only card 0; card 10 can run in parallel with 8-9 (no runtime code). Cards 0-8 only touch Act 1 or are memory hygiene; 9-12 wait for the director (rule 1).

## 7. Open questions for the director (max 6 open) and risks

### Questions

Answered on 2026-11-25 (details and consequences in section 8):

| # | Question | Status |
|---|---|---|
| Q1 | Is the partition acceptable? | **ANSWERED: yes, 7 sectors as written** (1) |
| Q2 | `arch-bridge` at (1300, 400) vs the generated crossing at (1190, 1060) | **ANSWERED: follows the generated crossing, by rule** (2) |
| Q3 | `cordillera` backdrop with no road in? | **ANSWERED: yes, jungle backdrop; plus at least one hiking trail near the airport (inside `corredor`)** (3) |
| Q4 | May portals take control away (fog ramp, speed floor, hold, lock cycle, train ride)? | **ANSWERED: transitions must be seamless; controls only if needed.** Design and the list of portals that need one: 3.3 and 8.3 (4) |
| Q5 | Closed portal stubs in Act 1? | **ANSWERED: no stubs; the map is blurred with distance instead** (5) |
| Q7 | Rule-based placement of catalogue anchors? | **ANSWERED in spirit: prefer rule-based placement for bridge/anchor landmarks that must sit on generated features** (2) |
| Q8 | Keep the whole-isthmus 2D raster resident? | **ANSWERED by decision 5: a tiered per-sector raster instead (M0/M1/M2, 8.5)**; interpretation to confirm (N2) |

Open (5):

| # | Question | Why it matters | My default if unanswered |
|---|---|---|---|
| Q6 | What happens to state in a retired sector (parked car, dropped item, reputation)? | retiring frees memory; state must live outside the sector | a small persistent store keyed by sector id; the car is despawned |
| N1 | Trail end point: is a ridge viewpoint east of the airfield (inside the Act 1 rect margin) the right destination, or should it end at a story place (e.g. `tito-home` side) or loop back to the terminal? (8.3) | the trail's start/end decide its length (about 1.0-1.5 km **[E]**) and whether it adds any Act 1 content | start at the terminal landside, end at the highest dry cell inside the rect east of the field, no mission attached |
| N2 | Is "map blur" = a **map-view LOD** (resolution and blur by distance from the player and by sector residency), as designed in 8.5, what you meant by "blurred like GTA's"? Does it also apply to the minimap rim? | defines card 4 and the raster memory plan | yes to both; blur is by distance from the player, M0 sharp only inside the resident sector |
| N3 | Airport grading: are retaining walls (<= 12 m vertical faces) and stepped terraces acceptable looks, and may the generator move earth up to the volume cap of 8.4, or should it also nudge the airport hint / heading? | decides between pure grading and grading + flat relief pocket; changes the look of the whole airport shore | grading with benches first (no walls above 12 m), then a flat relief pocket only if the guard still fails |
| N4 | Teleport / fast travel / debug fly are faster than any prefetch (up to 2000 m/s **[M]**): may a short loading veil (<= 1 s fade) appear only for those? | the only case where seamless cannot be met by prefetch alone (8.3) | yes, veil for teleport and debug-fly only; never for walking, riding or driving |

### Risks

| Risk | Detail | Mitigation |
|---|---|---|
| All budgets are placeholders | JS heap, GPU bytes, collider count, `T_build`, `T_upload`, frame p99 are unknown (card 0). Caps in 3.2 are ratios of unmeasured values | no cap is enforced until card 0 fills it |
| Stale Act 1 numbers | AUD's 6.13 km2 / 1,358 / 545 are yaml-only; edits gave 7.13 km2 / 1,160 / 612 and, after the airport grading, the rect is 5.68 km2 (x 3588-5450, y 562-3610) **[M]** with edges/buildings not re-measured (the 2026-11-25 capture saw 516 edges / 1200 buildings); the 161k near-ground tris and 760.7k overview were measured on the older map; the old example `v_max 30 m/s` for the car is replaced by the measured 16 m/s (3.3) | re-measure in card 0 |
| Generated map vs authored landmarks | correction 2; anchors can sit on water or ridges | rule-based placement (decision 2, card 2) |
| The Transístmica wobbles | it grazes the `corte` corner (2900, 3125) and the border at x 2900 within 85 m; borders chosen on a road invite repeated crossings | 120 m portal tolerance + the `portals-connect-adjacent-sectors` guard |
| Worker cost | the codec decode already makes a transient second copy (AUD s7); two workers + main thread can pass 16 GB-laptop comfort | one worker, one sector job at a time; decode once in the worker |
| Rapier `removeRigidBody` hitch | freeing thousands of colliders in one frame may spike | split the removal over frames; measure in card 4 |
| Name collision | `tools/reference-sectors.mjs` means real OSM bbox samples (issue #7), not game sectors | the new code uses `sectors.ts` and the `sector` group in the spec; rename nothing |
| Fragment data quality | `costa-del-este` is OSM-sparse (69 buildings), Paitilla and Albrook are unmeasured | grey-tier counts come from the game's own density, not the fragments |
| One-act-at-a-time | a streaming architecture is large; building it before Act 1 is playable breaks CLAUDE.md rule 1 | cards 0-8 only touch Act 1 or are memory hygiene; 9-12 wait for the director |
| Airport still floats after grading | siting found no natural flat site (8.4); grading moves a lot of earth and can bury the apron/road routes | volume cap + guard `airport-pad-floats`; fall back to a flat relief pocket (N3) |
| Map blur read as a bug | blurred distant map could look like missing data | blur only beyond the sharp radius, with a legend-free fade (8.5); confirm N2 |

## 8. Director decisions (2026-11-25) and their consequences

Cards 1-4 of this section are implemented (see section 6); the rest is not. Tags: **[M]** measured/quoted from source, **[D]** reported by the director, **[E]** estimated by arithmetic, **[P]** proposed.

| # | Decision | Where it changed this file |
|---|---|---|
| 1 | 7-sector partition accepted | section 1 intro, 1.3 (`cordillera`), card 5, Q1 |
| 2 | `arch-bridge` follows the generated road crossing; other bridge/anchor landmarks placed by rule | P1 note (2.3), 5.1/5.2 rows, 8.2, card 2, Q2, Q7 |
| 3 | `cordillera` is jungle backdrop; at least one hiking trail near the airport | 1.3, 8.3, card 3, Q3 |
| 4 | Transitions seamless; controls only if needed | 2.2 note, 3.1, 3.3, 5.1, 8.3, card 9, Q4 |
| 5 | No closed portal stubs in Act 1; the map is blurred by distance | 2.4, section 4 (2D maps), 8.5, card 4, Q5, Q8 |
| 6 | Airport sits on sloped terrain; needs grading | 8.4, card 1, guard `airport-pad-floats` |

### 8.1 Why the order of cards changed

Decisions 2, 3, 5 and 6 are visible in Act 1 (bridge position, a trail, the map, the airport look) and do not need streaming, so they become cards 1-4 right after the baseline (section 6). Streaming (9) and portals (12) wait for an act that crosses a border.

### 8.2 Rule-based placement of the arch-bridge and other landmarks on generated features (decision 2)

Current state **[M]**: `world.yaml` `canal.bridge_landmarks: [arch-bridge, cable-bridge]` is "landmarks that must sit on the channel", parsed in `src/world/spec.ts:1357` but consumed by no guard (`grep bridge` in `src/studio/guards.ts` finds only the road-crossing guard). `procedural.landmarks` already places the five Act 1 landmarks by rule (`src/world/proc/landmarks.ts:22`, rule kinds `anchor | along | steepest_within | airport`). The authored `arch-bridge` (1300, 400) is 650 m from the generated crossing (1190, 1060) **[M*]**.

Implemented (card 2, 2026-11-25) **[M]**:
- Rule `{ on: crossing, route: <roads route id>, feature: canal, tolerance: m }` (`src/world/proc/landmarks.ts` `routeCrossing`, parsed strictly in `src/world/spec.ts`, mirrored in `tools/render_map_preview.py`, documented in `specs/map/README.md` and `src/studio/params.ts`). The landmark is the first point where the generated route crosses the generated canal centreline, on the road centreline (the deck), with `heading` (degrees, [0, 180)) along the road; if an edit makes the route miss the canal it falls back to the closest approach and the guard fires. (The sketch below used `{ crossing: { route, with } }`; the built form is flat.)
- `arch-bridge: { on: crossing, route: interamericana, feature: canal, tolerance: 30 }`. On the saved-edits map it moved from the authored (1300, 400) to (1184, 1063), exactly on the crossing (the road is the same trunk as `gamboa-road`, which also crosses there). Moving the `balboa` stop 200 m north moves crossing and landmark together (tests/landmarks.test.ts). The Act 1 and airport landmarks did not move.
- Guard `bridge-landmarks-on-crossing` (`src/studio/guards.ts`); `pinned-places-on-land` skips crossing landmarks because a bridge sits on the channel by design. Mutations: arch-bridge pinned to (1300, 400) -> test red; guard tolerance loosened -> test red.
- NOT done: `cable-bridge` keeps its authored spot (1262, 3300): the only generated line crossing the canal near it is the `railroad` at about (1582, 3290), 320 m away, and the landmark is a highway bridge, so the same rule would move it onto a railway; no generated road crosses the canal there. `free-zone`, `domo-del-radar`, `atlantic-locks` are still authored. The game reads the rule position for `arch-bridge` (`game-spec.ts` takes the placed position and `heading`), the authored x/y stay in `landmarks:` for the Python checks.

Original proposal, kept for the other landmarks **[P]**:
- New rule kind `{ crossing: { route: <route id>, with: canal | river:<id> } }`: the landmark is the point where the generated route crosses that water (nearest to a hint if several). The same point is the position of portal P1 (`on: { route, border }`, 5.1), so the landmark, the deck and the border cannot drift apart.
- Same idea for the other landmarks that must sit on a generated feature: `cable-bridge` (see above; needs a road that crosses there or a `{ canal_at: fraction }` rule, or to be dropped), `free-zone` (on a 150-250 m hill: `{ flattest_within: m }`), `domo-del-radar` (already described as a rule: highest dry cell within 700 m of the Gamboa seed), `atlantic-locks` (the generated lock).

### 8.3 Seamless first; which portals really need a control mechanic (decision 4)

Seamless design: 3.3 (prefetch by distance with `CAR.maxForward = 16 m/s` **[M]** against a 1200 m radius **[P]**, worker generation, progressive tiers, double-buffered swap hidden by distance or portal geometry, 30 s hysteresis). Under that design:

| Case | Control mechanic needed? | Why (what would be false without it) |
|---|---|---|
| P1, P2 viaducts (A) | **no** | the swap is a tier promotion outside the camera footprint or behind the deck walls; at 16 m/s the prefetch margin is >= 10x **[E]**. The fog ramp and speed floor of 2.2 stay as off-by-default fallbacks |
| P3, P4, P5, P7, P8 tunnels / cuttings (B, D) | **no** | the terrain or roof occludes the change; nothing to hide by taking control. The rail tunnel (D) is a place to ride, not a loading screen |
| P6, P9 locks (C) | **no** | the 60-90 s lock cycle is flavour (a place), no longer a mask; skippable |
| P10, P11 causeways (E, sea on both sides, weakest occlusion) | **no, but watch** | the swap target is a < 0.5 km2 satellite or a `blocks` sector, so the promotion is small; if card 9 shows a visible pop here, use the 12 m/s speed floor only on this portal **[P]** |
| `ciudad`/`corte` and `corte`/`ribera` seams | **no** | no portal, flat plain; streaming by distance only |
| On-foot crossings (1.1-1.6 m/s) | **no** | prefetch warning is 750 s **[E]** |
| **Teleport, fast travel, debug fly (up to 2000 m/s `FLY.maxSpeed` [M])** | **yes: a <= 1 s loading veil (N4)** | the destination sector cannot be prefetched when the camera jumps; without the veil the player would see the `silhouette` tier promote at once |
| **Worker late (fallback)** | **yes, but should never fire** | if `T_build` exceeds the 75 s warning, holding at the border is better than a pop; logged as an error |

Result: **no portal in the table needs a standing control mechanic**; only teleport/debug movement and the late-worker fallback do. This is a [P] conclusion that depends on card 0 measuring `T_build`/`T_upload`.

#### The airport hiking trail (decision 3)

**Card 3 IMPLEMENTED (2026-11-25), spec + generated route + guard + preview drawing only [M].** `procedural.trails` (`specs/map/world.yaml`, strict parser in `src/world/spec.ts`, `specs/map/README.md`, Map Studio `src/studio/params.ts`, Python mirror `tools/render_map_preview.py`), generator `src/world/proc/trails.ts` (`leastCostPath`, cost `len (1 + 2 (grade / (max_grade / 2))^2)`, refuses cells above `max_grade`, water, the airfield plus a 20 m fence, built cells and anything outside the Act 1 rect), `Isthmus.trails`, own hash `hashes.trails` (joins `hashes.all` only when a trail exists, so a map without trails keeps every hash), dashed cream line with a dark casing in `src/world/proc/render.ts` (restyled 2026-11-25 from a thin dark-green line, which was nearly invisible over the jungle hillshade) (`npm run isthmus`), guard `trail-connected-and-grade`, `tests/trails.test.ts`. The viewpoint is a rule (`to: { highest_within: 900, margin: 120, min_distance: 700 }`: the highest dry unbuilt cell within 900 m of the airfield, inside the Act 1 rect shrunk by 120 m, at least 700 m straight from the terminal; the next highest candidate if the highest needs more than `max_length`), not the east ridge sketched below: inside the rect the highest candidate is inland of the terminal (about 75-85 m), because the 182-241 m ground east of the field is outside the rect. Measured: saved-edits map (4750, 2910) to (4030, 2610), 1175 m, grade p50 0.055 / p90 0.123 / max 0.177; unedited map (4910, 2670) to (4290, 2290), 1164 m, max 0.211. The YAML below is the original proposal, not the built shape.

**Follow-ups, NOT built (the trail is data only; the game does not read it):**
- walk graph: a `trail` class in `WALKABLE_STREET_CLASSES` (`src/world/spec.ts:128`) and `population.pedestrians.walk_on`, trail edges from `Isthmus.trails` into the walk graph and `src/world/world-data.ts` (exact files to confirm when the card is opened);
- mesh: a footpath ribbon (`width` 1.2 m, terrain-following, not drivable, no kerb) in `src/engine/meshes.ts` and `src/plugins/world-view.ts`;
- minimap and world map: a thin line in `src/ui/minimap-layer.ts` and `src/ui/world-map-canvas.ts` (and the LOD tiers of 8.5);
- physics and traffic: keep vehicles off it (`src/plugins/world-physics.ts`); a footpath needs no collider;
- game spec: `gameSpecFromIsthmus` (`src/world/proc/game-spec.ts`) adds no route for it; a `trail` route kind would be needed;
- the viewpoint is a plain point: no landmark, mission, character or story content (CLAUDE.md rules 3-4).

How paths are modelled today **[M]**: `src/world/proc/paths.ts` is only the least-cost A* router (16-neighbour, caller-supplied edge cost) used for roads, the railway and the canal; it is not a footpath model. `world.yaml` has **no `paths` section** (its top-level keys are version, bounds, grid, geometry, districts, landmarks, routes, active_area, street_profiles, scale, street_styles, blockout, relief, canal, population, procedural). The nearest existing things: `procedural.roads.routes` kinds `highway | road | rail` (`roads.ts:15`), the street class `alley` (3.5 m, no sidewalk, walked on its centerline, `street_styles.hierarchy`) and `population.pedestrians.walk_on` / `WALKABLE_STREET_CLASSES = [avenue, collector, local, alley]` (`spec.ts:128`). Nothing models a trail.

Proposal **[P]**, adapted (a game trail, not a copy of any real one): a new `procedural.trails` entry routed with `leastCostPath` on a hiking cost, and a new walkable class `trail`:

```yaml
procedural:
  trails:
    airport-ridge:
      from: { airport: terminal }              # landside of the Act 1 passenger terminal (rule, not x/y)
      to:   { highest_within: 700, of: { airport: field-edge, side: east } }   # ridge viewpoint over the runways
      width: 1.8                               # m, footpath, no sidewalk, no vehicles
      grade: { g0: 0.12, k: 2 }                # cost scale and weight, same shape as roads.grade
      max_grade: 0.40                          # blocks steeper edges
      avoid: [water, airfield, built]
      inside: act1-rect                        # both ends and the whole line stay in the full-tier rect
```

Where it starts and ends **[E]** from the director's numbers: Act 1 airport field centre (5019, 2858), 1300 x 360 m, heading 10 deg, terminal at (4753, 2905) **[M*]**, i.e. the terminal is on the west (city) side and the long axis runs nearly north-south, so the field's east edge is near x 5200. Terrain east of the field rises 38 -> 90 -> 182 -> 241 m at 0/300/500/650 m **[D]**, so the natural ridge is east, 500-650 m from the centre, partly beyond the Act 1 rect (x max 5465) **[M*]** but inside the playable boundary (east barrier near x 5700-5950, `world.yaml`). The trail therefore **starts at the terminal's landside, skirts the south end of the field outside the fence (about 0.6-0.8 km), and climbs east to a viewpoint at or inside the rect's east margin**, about 1.0-1.5 km, 10-15 min on foot at 1.6 m/s **[E]**. The exact end is N1; if the highest point is outside the rect the end clamps to the rect (that is the `inside` rule). It depends on 8.4: the graded embankment must not cut the trail (route after grading). No mission is attached (CLAUDE.md rules 3-4); the airport shore is Act 1 ground, `cordillera` stays plain jungle. Guard `trail-connected-and-grade` (5.2). Needs one new walkable class `trail` in `WALKABLE_STREET_CLASSES` (walked on the centerline like `alley`) and `walk_on: [..., trail]`.

### 8.4 Airport grading (prerequisite for the Act 1 sector's look)

**IMPLEMENTED (card 1, 2026-11-25), as described in "As built". The "Proposed" list further down was the plan; the parts marked NOT BUILT are future work.**

Facts. Code **[M]**: the old code called `levelAirport(height, airport, 150)` (`src/world/proc/airport.ts`; still used when `grade_slope_max` is 0): every cell inside the field set to `a.level` (the **mean** of the field, `siteAirport` `level: best.mean`) and, outside it, `h += (level - h) * (1 - smoothstep(d/150))` over a fixed 150 m ring. The siting score is height **spread** plus a distance penalty, so it picks the least-bad site, it does not grade. `world.yaml` already records the cost: "further north ... the field is 69 m of earthworks". Director-verified with the saved Studio edits **[D]**: field 1300 x 360 m, heading 10 deg, centre (5019, 2858), levelled to 38.1 m while the natural spread inside it was 37.5 m std; terrain east 38 / 90 / 182 / 241 m at 0 / 300 / 500 / 650 m; west 10-29 m; south falling to about sea level from 800 m, so the pad floats; a scan of x 3000-5800, y 900-3700 found **no natural flat site** (best alternatives std >= 50 m). Moving the airport does not fix it.

Why it looked bad **[E]**: the blend matched height but not slope, and its length did not depend on the height difference. A 203 m rise (241 - 38) over 150 m with smoothstep (peak gradient 1.5) is about 2.0 m/m (about 64 deg) **[E]**, a wall; on the fill side the terrain beyond the ring keeps falling, so the pad reads as a table with a lip.

#### As built **[M]**

- `gradeAirport(height, a, s, reach)` (`src/world/proc/airport.ts`), called from `src/world/proc/isthmus.ts` when `procedural.airport.grade_slope_max > 0` (else the legacy `levelAirport` 150 m blend). Parameters in `world.yaml`: `grade_slope_max: 0.35` (rise/run, about 1:3) and `grade_reach_max: 600` m (documented in `src/studio/params.ts`).
- One slope for cut and fill, earth only (no walls, no benches). Inside the field the ground is exactly `a.level`. Outside it, at distance `d` from the field edge (Euclidean distance to the rectangle, `fieldDistance`), the ground is the natural ground limited to `level +- s*d`, then swept outwards from the field, nearest cells first, so that no cell differs from an already graded neighbour by more than `s` per metre: cliffs inside the reach become a ramp that meets the natural ground where it can, and the ramp lengthens with the height difference.
- The slope limit holds out to 75 % of `reach`; the last quarter of `reach` fades back to the natural ground so nothing steps at the cap (where a ramp has not met the natural ground yet, the fade gives way to it).
- Pure and deterministic; runs before roads and rivers are routed.
- Guard **`airport-pad-floats`** (`src/studio/guards.ts`): fires when `grade_slope_max` is 0 (legacy blend), when the embankment slope over the ring exceeds `grade_slope_max` (2 % tolerance), or when the grading stops more than that slope off the natural ground (`grade_reach_max` too short). Tests: `tests/airport-grading.test.ts`.

#### Proposed in the first draft and NOT BUILT (future)

- Separate `cut_slope` (0.5) / `fill_slope` (0.33) parameters: not built; one `grade_slope_max` serves both.
- Benches (6 m berms every `bench_every` m), retaining walls (`wall_max`) and the cut/fill cap that triggers them: not built (walls would need a `world-view` mesh feature).
- `smooth_passes` box-blur of the graded ring: not built; the fade of the last quarter of the reach replaces it.
- Volume cap: `cutM3` / `fillM3` report and a guard bounding them: not built.
- Optional flat relief pocket (a new relief zone kind pulling the natural relief towards a plateau at the airport hint), N3: not built.
- Embankment-volume term in the siting score: not built.
- Guard thresholds `d_max` 400 m, `step_max` 6 m per cell, `fill_max`, and the `procedural.airport.grading` control group of 5.1: not built; the shipped guard and parameters are the ones above.

#### Original proposal (kept for reference) **[P]**

Daylight grading with `graded = level + clamp(delta, -fill_slope * d, +cut_slope * d)` (cut 0.5, fill 0.33), benches every 10 m of height, walls where `|delta|` exceeds 25 m up to 12 m, 2 smoothing passes, a cut/fill volume guard, and a guard `airport-pad-floats` with `d_max` 400 m, `step_max` 6 m and `slope_max` = `cut_slope`. Only the daylight-grading idea (slope-limited ramps whose length follows the height difference) was built, in the simplified form above.

Mutation run with card 1: setting `grade_slope_max` to 0 (the legacy blend) makes `airport-pad-floats` red on the saved edits; restoring it, green (tests/airport-grading.test.ts).

### 8.5 Map-view LOD: blurred like GTA (decision 5), answers old Q8

**Interpretation to confirm (N2):** "the MAP (world map + minimap) is blurred ... sharp and zoomed-in near the player, blurred / low-detail further away" is read as a **map-view LOD**: raster resolution and blur chosen by distance from the player and by sector residency. It replaces closed portal stubs: instead of a closed gate, the unreachable world is shown as soft, low-detail ground. It is not a screen-space blur of the 3D view.

What exists **[M]** (code constants; canvas bytes themselves not measured, AUD never recorded them): `world-map.ts:15,19` `DETAIL_M_PER_PX = 1` and `BASE_M_PER_PX = 6`; `bakeIsthmusBase` (`map-base.ts`) bakes the whole 6000 x 8000 box once (cover + hillshade + water, sea transparent); `renderStaticLayer` (`minimap-layer.ts`) bakes the Act 1 rect + 100 m margin once (streets, blocks, buildings); `plugins/minimap.ts:9` has its **own** layer at `metersPerPxLayer: 1.5`. `drawWorldMap` (`world-map-canvas.ts:222-270`) draws sea, land, the base image, then the detail layer clipped to `slice.rect`, then the boundary hatch. So today there are already two tiers with a hard seam at the rect edge and no distance blur.

Proposed tiers **[P]**, memory by arithmetic (RGBA 4 B/px) **[E]**:

| Tier | Content | m/px | Blur | Covers | Bytes [E] |
|---|---|---|---|---|---|
| M0 sharp | streets, blocks, buildings, trail, landmarks (today's detail layer) | 1 (zoom limit `MIN_M_PER_PX 0.5` stays) | none | the **resident** sector's full-tier rect + margin (Act 1: 2609 x 3158 px) | 33.0 MB (1 m/px); the minimap's separate layer is 1740 x 2106 px = 14.7 MB at 1.5 m/px |
| M1 soft | cover + hillshade + water (today's base) per sector | 6 | about 1.5 px | every sector (always resident); whole isthmus = 1000 x 1334 px | 5.3 MB total (`corredor` 1.36, `ciudad` 0.43, `lago` 1.20, `cordillera` 1.22 ...) |
| M2 far | same, downsampled and blurred, no hillshade detail | 24 | about 4 px | whole isthmus, always | 0.33 MB total |

Behaviour **[P]**: a pure function `mapTierAt(distanceFromPlayerM, metersPerPx)` (in `src/sim/map-view.ts`, unit-testable) returns the tier and a blend weight: sharp radius = the visible map radius at the current zoom, then a ramp of about 2x that radius from M0 to M1 to M2, so the sharpness follows the player and the zoom. `drawWorldMap` draws M2, then M1, then M0 through a radial soft mask centred on the player (a `destination-in` radial gradient, same trick `bakeCover` already uses); blur is pre-baked per tier, not a per-frame canvas filter. The map redraws on demand (not per frame), so the extra draw calls cost nothing at rest **[E]**. The minimap (200 px circle, ranges 150/400 m `minimap.ts:9`): the rim fades from M0 to M1 with the same function, and the minimap stops owning a second 1.5 m/px layer by sampling M0 (saves 14.7 MB **[E]**; check the minimap look at 400 m range in card 4).

Sector residency: M2 and M1 are never freed (5.4 MB **[E]**); M0 belongs to the resident sector's `Scope` (card 6) and is built on `prefetch` and freed on `retiring -> unloaded`; at most two M0 exist (active + prefetch). In Act 1 only the `corredor` M0 exists; every other sector shows M1/M2 (cover, hillshade, water: it never shows streets it does not have). Worst case with two M0: 2 x 33 MB + 5.7 MB = about 72 MB **[E]**; cap proposed 80 MB **[P]**, enforced by the guard `map-raster-budget` (5.2); a 0.25 m/px M0 would be 16x, about 527 MB, and must be refused by it **[E]**. Build time of the M0/M1 bakes is logged at `world-map.ts:67` but never recorded: card 0 records it (to-measure).

What it means for the card plan: new card 4 (section 6) owns `map-base.ts`, `world-map-canvas.ts`, `minimap-layer.ts`, a pure tier function and its test; card 8 frees and rebuilds M0 with the sector; card 5 (sector table) feeds M1 per sector. The old Q8 default ("keep the whole raster resident") is replaced: only M1 + M2 stay resident (5.7 MB **[E]**).
