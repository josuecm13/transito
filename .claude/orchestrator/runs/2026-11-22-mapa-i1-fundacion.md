# Run 2026-11-22 (session 3, part 2) — Map from scratch: I1 Foundation

## Goal

Director: "start over with the map, follow the workflow, I already told you my vision, now it's your
turn." Build the layered map from `docs/map-reshape/` (plan by B1, previous run). This run: issue
**I1 Foundation** (F01–F04, F06). Then I2 Nature → I3 Airports + main roads → I4 Act 1 detail → I5
City bayfront skeleton.

## Director's vision (his words, earlier in the session)

- Coastline / map shape stays. Generate on top: jungle → elevation → rivers + Panama Canal →
  airports → main roads (Interamericana) → secondary roads → streets → blocks → buildings.
- Nature + main roads over the whole isthmus; detail only in the active area.
- Real OSM data as references; compressed real geometry "might help"; how Rockstar approximates.
- Panama City signature places + the coastway (Cinta Costera).

## Decisions taken by the orchestrator (delegated by the director: "now it's your turn")

Answers to the 12 questions in `docs/map-reshape/02-alternatives/recommendation.md`:

| # | Decision |
|---|---|
| 1 | Approach C (hybrid): authored routes in world.yaml are truth; warped real refs are overlays / first drafts only |
| 2 | Yes: simplified OSM polylines baked into `specs/map/refs/` with provenance + "© OpenStreetMap contributors" (ODbL), never fetched at runtime |
| 3 | "Start over": layers 6–9 of the corridor are generated fresh from layers 1–5. The La Carpio seed is retired from `tito-corridor` in I4 (files kept); La Carpio stays as the realism reference band |
| 4 | Soft haze (the 3D camera now shows the horizon) |
| 5 | No new invisible walls; existing `playable_boundary` stays; gating decided per act later |
| 6 | Allowed: land-cover refinement pass after relief + rivers (layer 1b) |
| 7 | Yes: the Interamericana absorbs `corridor-avenue` and the city end of `transisthmian-highway` (corridor landmarks stay on it) |
| 8 | Yes: `water_bodies` (Gatún Lake, canal inlet) without touching `geometry.land`; `cable-bridge` moves onto the channel |
| 9 | Keep the 2 × 1,500 m runways for Act 1; Albrook = landmark only (F21 dropped) |
| 10 | Corredor Sur yes (skeleton); Cinta Costera viaduct on the bay side; Corredor Norte skipped; anchors = B1's proposed list |
| 11 | Yes: 16 m far grid outside the active rect |
| 12 | CLAUDE.md rule 5 wording: proposed to the director for approval (agents never edit CLAUDE.md); not a blocker for I1 |
| — | Land cover source: OSM (Overpass) shares only, no WorldCover (it needs a new GeoTIFF dependency) |

## Cards

| Card | Features | Agent · model | Weight | Outcome | Fix rounds |
|---|---|---|---|---|---|
| C2 refs + anchors + warp | F01, F02, F06 + record decisions in docs | general-purpose · sonnet | light (network + small tests) | done — orchestrator re-ran warp (7) + bake-refs (9) tests, `--fold` (0 folded Delaunay triangles; 18/165 flipped triples around the bay), refs 768K with OSM attribution; package.json: only `refs` line is new. Agent reported 2 mutation checks | 0 |
| C3 spec shapes + layer skeleton + contract test | F03, F04 | general-purpose · sonnet | heavy (tests, typecheck) | done — orchestrator re-ran validator (exit 0), typecheck, 6 test files (all pass) and looked at preview.svg (top + bottom halves). Agent reported 5 mutation checks (contract, strict parser, river mouth inland, road over water, cable-bridge off channel) | 0 |
| C4 layer 1 land cover + layer 2 relief (whole isthmus, calibrated, wired to ground) | F10, F11 (I2) | general-purpose · sonnet | heavy | done — orchestrator re-ran typecheck, validator, 7 test files (all pass) and took screenshots (top-down unchanged; 3D shows hazy ridge silhouettes). New tests/terrain.test.ts with real slope bands (thin margins: p50 .074≤.080, p90 .262≤.285, <30 m 23.8≤25.7 %). Ridges narrowed/lowered vs doc to pass crest + p90; airport flatten rect/order changed (runway level 3.86→4.61 m). Agent reported 4 mutation checks | 0 |
| C5 layer 3: rivers (D8), canal, Gatún Lake, locks, Chagres → lake, gamboa on bank | F12, F13 (I2) | general-purpose · sonnet | heavy | partial — layers-water 14/14, typecheck, world-data (median 1254 ms / 1500) pass (re-run by orchestrator); terrain.test.ts 2 RED: isthmus slope p50 0.083 > 0.080, share <30 m 36.4 % > 25.7 %. Cause: lake basin + canal cut through C4's 80 m upland. Orchestrator diagnosis: the whole-map hypsometry band compares a non-uniformly compressed map to a uniformly measured real isthmus → needs per-zone (compression-aware) bands; next card. Game loads (60 FPS, WebGPU, 586k tris, 103 MB JS heap) | 0 |
| C6 draw layers 1–3 on Tab map + minimap | (visibility) | general-purpose · sonnet | light | done — orchestrator screenshot of Tab map shows cover, hillshade, lake, canal, locks, rivers; typecheck ok | 0 |
| C7 debug mode: free-fly + whole-map overview + teleport (`?debug` / F2, O) | director request (lost from an earlier session, repeated 2026-11-22) | general-purpose · sonnet | moderate | done — orchestrator re-ran typecheck + debug-fly 13/13 and captured `?debug` + O: whole isthmus visible in 3D (60 FPS). Agent reported 2 mutation checks | 0 |

## Open items

- From the debug overview: inside the active rect the ground outside streets is flat grey-olive (not coloured by cover) → visible box edge; settlements are perfect discs; relief reads weakly from 8.9 km up.

- Tangent (not fixed): leftover `console.log('[dbg] layers' …)` in src/plugins/world-view.ts:150 (uncommitted, earlier session). Remove in a cleanup card or with the director's OK.

- **I1 done** except F05 (CLAUDE.md rule 5 — awaiting director).
- For I3: Interamericana ref is fragmented in OSM (by `ref=1` ways); only the east end (Tocumen→Pacora) is one path. Re-bake from the route relation before using its tortuosity (1.087 = east stretch only). Autopista 'interchanges' are *_link clusters (~11.7 km apart), not true interchanges.
- Panamá Viejo real coords corrected to (9.0084, -79.4889) in anchors.yaml; `01-investigation/panama-city-signature-places.md` still has the old memory value (~1.5 km off).

- Found: `tests/terrain.test.ts` is cited in world.yaml as enforcing `relief.targets` but does not exist → slope calibration was never tested. C4 creates it.

- For I2 (from the preview review): `rio-chagres` reaches the Caribbean EAST of Colón; the real Chagres feeds Gatún Lake from the east (and the lake spills to the Caribbean west of Colón). Move/rename in I2. Gatún Lake polygon ≈ 4 km² vs the 8-cell budget. `gamboa` landmark sits exactly on a canal vertex (should be on the bank).
- C3 choices to surface: Interamericana kept arterial (14 m) not highway; Bridge of the Americas node at (1335, 520), 86 m from `arch-bridge`; Transístmica now ends at corridor-market.

- Track A failures (street-seed junction, walk-graph node 1386) likely become moot when I4 retires
  the seed; re-check then, don't fix now.
- C1 camera (#9): awaiting the director's playtest.
