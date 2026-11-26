# 2026-11-23: Mapa — composición (A1 + A2 + B1)

**Goal:** the procedural map reads as small capital → patchy El Corredor → green → isolated airport
(#13 comment 1/3), before #12 2.2 places Act 1. **Mode:** lean. **Issue/milestone:** #12 (before 2.2), #13 layout.
**Resume from:** `runs/archive/2026-11-24-next-session-handoff.md` (decisions pending; nothing committed)

## Verified state
See `2026-11-23-mapa-opciones.md` (same day). Re-checked: `main` = `origin/main` = `c376cc4`; fingerprint
of `generateIsthmus` = `/tmp/transito-split/fp-fixed.txt` (11 parts); Línea 2 east midpoint (3929, 1070).
In-memory probes (repo untouched, `/tmp/transito-opts/try.ts`):
- hint [5450, 3250] + towns 2.0/0.6/0.8 → airport (5110, 2830) heading 0°, isolated; corridor and
  Línea 2 re-route north up a valley; midpoint → (3765, 2680); the ferrocarril follows the new road.
- hummocks amplitude 170 or 200 → `routeRoads: gamboa-road leg 1 unreachable` (not tunable; B2).

## Cards
| # | Card | Check | Result | Fix rounds |
|---|---|---|---|---|
| 1 | B1 generator: `towns.separation`, `towns.airport_buffer`, per-town `patches`; spec + parser + Python mirror + README; defaults off | fingerprint == `fp-fixed.txt` (11 parts); `node --max-old-space-size=1536 --test --test-timeout=120000 tests/proc-isthmus.test.ts tests/spec.test.ts`; `python3 tools/render_map_preview.py`; `npm run typecheck`; new guards mutation-checked | green: fp identical (keys off); tests 10/10 + 19/19; validator 0; tsc 0; mutations M1 separation check, M2 gap build, M3 threshold frac, M4 separation nonneg → red, restored → green; Python mirror: 3 broken values flagged, exit 1 → 0 | 0 |
| 2 | A1 + A2 + B1 values in `procedural:` (airport hint/heading, corridor via stops, town targets, separation, buffer, patches) | render `.cache/isthmus.png` and look; report line; tests + validator green | green: 5 in-memory trials (t1-t5, `/tmp/transito-opts/`), t5 applied; 54/54 test files one by one, determinism 54/54, tsc 0, validator 0; real-map guards (separation, airport buffer, reach) mutation-checked M5-M8 → red, restored → green | 1 (`reach` added: corridor grew onto the plain) |

### 1. B1 generator
Files: `src/world/proc/settlements.ts`, `src/world/proc/isthmus.ts`, `src/world/spec.ts`,
`tools/render_map_preview.py`, `specs/map/world.yaml`, `specs/map/README.md`, `tests/proc-isthmus.test.ts`
Sources of truth: `specs/map/README.md` → "Procedural isthmus"; #13 comments 1 and 3.
Out of scope: lake/canal/rail (B2-B4), landmarks (#12 2.3), `target_km2` semantics (open question).

### Result (t5 → world.yaml)
airport (5310, 1820) 5° → **(5170, 2620) 10°**, spread 38.5 m, 350 m town-free buffer · towns la-ciudad 1.75/1.8,
colon 0.59/0.6, balboa 0.45/0.45, el-corredor 0.54/0.6 (reach 400, patches), separation 200 m ·
`corridor-east` (4700, 1500) via stop on the Interamericana and Línea 2 east · **Línea 2 east midpoint
(3929, 1070) → (4285, 1273)**, 71 % El Corredor cells within 340 m. Vision's ~(5440, 3270) rejected:
cordillera-south spur → 69 m spread, El Corredor 0.00 km² (t2).

## Decisions and open questions
- Director 2026-11-23: order A1+A2+B1 → #12 2.2 (derived) → 2.3/2.4 → 2.5 → B2/B4/B3 → #13.
- Choosing A1 = the airport moves north (moves Act 1 / "under the flight path"); taken as approved.
- Línea 2's east branch gained a via stop (`corridor-east`); same two branches and endpoints, so the
  one-line-or-two decision is untouched. Flagged to the director.
- Open: Línea 2 one line or two; "line 8" = Línea 2?; `target_km2` net?; #11 controls; one railway or two.

## Lessons
- redone: probe commands ran without tests because zsh does not word-split `$T`; re-ran with a shell function.
- cost: five full renders viewed as images during tuning (each ~1 image of context).
- rule: guard a rule enforced in two places by mutating both; a single-site mutation can stay green.
