# 2026-11-24 — pendientes: verificación visual, guardas, #12 comentarios, plan #11 (lean)

Mode: lean, autonomous. No commit/push (director's rule). Start: main = origin/main = 11f3522, tree clean (verified).

## Cards
| # | Card | Agent·model | Check (by the orchestrator) | Result | Fix rounds |
|---|---|---|---|---|---|
| 1a | Look at depthPrepass fix | orchestrator, dev server + `tools/capture.mjs --gpu metal` | captures `/tmp/transito-g2/{debug,overview,v3d}.png` | Overview (`?debug`+O): whole isthmus, **no water sheets over the mountains**; V-view from the spawn: horizon mountains clean. **NOT verified at the car pose (3592,1425)**, the brown seam or the sea under the cliff (4330,1663): see lesson 2. | – |
| 1b | tito-home vs generated streets | orchestrator, `tools/home-probe.ts` (reads the baked isthmus + `buildWorldData`) | measured | tito-home (4270,1290): nearest generated street **4.8 m** (`local`, tito-corridor; carriageway+sidewalk reach 5.5 m) → the house sits on that street's sidewalk. Avenues 21.6 m (the #14 fix holds for those). Alley 29 m. **Proposed issue, not fixed.** | – |
| 2 | depthPrepass guard | general-purpose·sonnet | re-ran test 3/3; own mutation (far ground add without prepass) red, restored green | `tests/depth-prepass.test.ts`; `addGround(scene, mesh)` in `src/engine/meshes.ts` used by both ground sites in world-view. Agent's mutations: far, near, colorWrite, depthWrite all red→green. Part of the guard is a source-text check on world-view.ts (full scene needs the plugin context). | 0 |
| 3a | growTowns areasKm2 | general-purpose·sonnet | read settlements.ts 207-215 + test at proc-isthmus.test.ts:189 | **Already fixed in f6f7b2c** (recount from final owner + guard with river case). The issue comment is stale. Agent mutated: red `town 0: reported 1.8, built 1.7536`, restored green. Open design point, not changed: crossed river cells still spend the growth budget, so net area lands below `target_km2` (decision 8 in the plan: `target_km2` net?). | 0 |
| 3b | smoothAvoiding segments | general-purpose·sonnet | re-ran test 2/2, fp vs baseline | `walkCells` DDA; a smoothed segment may only cross blocked cells the raw path already crosses. Round 1 (strict "no blocked cell") sent 3 lines (transistmica, railroad, ferrocarril) to raw and changed roads/transit hashes → rejected. Round 2: fp identical to baseline except `tito-home (4270, 1290)` (expected, #14). Repro: a single blocked cell did not reproduce; found by random 20×20 search (3 isolated blocked cells). In the real world the old code never produced a crossing, so this is protection, not a visible fix. Mutations: vertex-only → red; strict rule → red (after replacing a test fixture that stayed green). | 1 |
| 3c | Línea 2 question | same agent | `git diff specs` | Row 12 added to `specs/story/open-questions.md`; network untouched. | 0 |
| 3d | Visual gaps | – | – | Not built; each has its slot: lake islands = B2, Gamboa/bridge = B3, Línea 3 north branch = B4, beige urban texture = #13 step 7. | – |
| 4 | #11 plan | orchestrator | measured on captures | below | – |
| 5 | #9 | – | – | Reminder: still needs the director's browser test of the camera (V cycle, chase, minimap rotation). | – |
| 6 | #13 | – | – | Untouched (blocked by #12 2.1 per its order). | – |

## Findings (for the director to approve as issues; nothing filed)
1. `[transito] tito-home sits on the sidewalk of a generated local street` (4.8 m from the centreline of a tito-corridor `local`). #14 only cleared avenues. Relates #14.
2. `[transito] leastCostPath checks only the midpoint cell of knight moves`: raw legs can clip a blocked corner (transistmica/ferrocarril touch lake cell (111,272)). Relates #12.
3. `[transito] ?debug starts at (0,0), 0 m, in the sea` (seen again in `debug.png`): already in the #11 notes; it is the first thing #11 must fix.
4. `[transito] dev pose hook`: no way to put the camera or the car at a world pose from a capture. A `?pose=x,y,yawDeg` for the 3D camera (dev only) would make visual checks reproducible. Out of scope here.
5. `[transito] 3D camera at spawn: Tito's capsule and an orange ring/beam fill the view` (v3d.png). Only noted; possibly the spawn marker. Needs the director's eyes (#9).

## #11 plan (proposed, waiting for the director's go)
Measured (1280×720, Chrome headless on Metal, HUD): `?debug` start 420.6k tris / 7 draws / 60 FPS; overview (O) **760.7k tris / 32 draws / 60 FPS** (vsync cap, so headroom unknown); V-view at spawn 760.3k / 21 draws. Near ground 161,417 triangles ×2 with the prepass = 323k; the other ~437k is far ground (×2), water, 1,358 buildings, 40 peds (split not measured).
Budget: overview ≤ 400k tris, ≤ 40 draws, **≤ 8 ms GPU frame (≥ 120 FPS headroom on this laptop; ≥ 60 FPS floor)**, measured uncapped.
| Step | What | Check |
|---|---|---|
| L0 | Per-layer triangle counters in the HUD + an uncapped frame-time reading (no vsync) | captures in overview and low flight |
| L1 | Start: `?debug` default = overview pose; `?play` / F2 enters the player mode; pure `startMode(search)` + test | mutation: default flipped → red |
| L2 | Prepass for the far ground on a coarser proxy mesh (it only has to occlude), with a larger polygon offset | no water sheets again in overview + low flight; tris −≥ 150k |
| L3 | Far terrain by tiles with 3 levels (e.g. 96/192/384 m edges) + skirts; level = pure function of (distance, height) | pure test of the selector; mutation; no cracks in captures |
| L4 | Buildings: hide/merge beyond a distance in free flight; peds/traffic off in plane mode | draws and tris reported |
| L5 | Captures `docs/screenshots/debug-avion-{general,bajo}.png` with FPS/tris/draws | look before saying done |
Cost ≈ 4 sonnet cards, serialised (heavy). Open for the director: airplane controls or the current free-fly (the F3 note says either is fine).

## Lessons
1. **The depth-prepass fix** (11f3522): ground layers write no depth by design (so they stack without z-fighting), so a hill occluded nothing and the lake/far water showed through mountains. The fix draws the same geometry first, depth-only, with a polygon offset. Any new ground layer or LOD mesh must go through `addGround` (guarded by `tests/depth-prepass.test.ts`), otherwise the bug returns silently. Note the guard on call sites is partly a source-text check.
2. **Agent captures do not reproduce driving poses.** `tools/capture.mjs` can press keys and nothing else; the game exposes no pose hook (`window.__game` exists only in player-lab), and the debug teleport lands 300 m up. So a view "from the car at (x,y) facing north" can be neither reproduced nor claimed. Say "not verified at that pose", and use the spawn/overview as a proxy only for what is pose-independent (here: water sheets over mountains).
3. An inherited "open comment" can be stale: #12's growTowns comment was already fixed in f6f7b2c. Read the code before delegating.
4. A fix that is correct in principle can silently regress real geometry: the strict `smoothAvoiding` rule changed 3 lines. The fingerprint caught it. Always run the fp for geometry changes.
5. A guard fixture that stays green under its own mutation is not a guard (paths-smooth test 2 had to be rebuilt).
6. Subagents here run in a sandbox without the repo's git sometimes ("no git repo" claim): verify the tree with `git status` yourself; agent type `implementer` is not registered in this harness, so project cards use `general-purpose`·sonnet with the brief template.
