# Run: map reshape — test hunt, frontage memory blow-up, memory-safe determinism checks (2026-11-22)

Resumes `archive/2026-11-22-map-reshape-handoff.md` (steps 1–2).

## Goal

1. Finish the test hunt (9 files not yet run), typecheck, map validator.
2. Find and fix the frontage-lots memory blow-up.
3. Director request: make the determinism checks memory-safe and skip them by default when
   developing locally (opt-in run).

## Decisions

- Root cause of the memory blow-up: `sampleDimension` (`src/world/streets/frontage-lots.ts`) drew
  `u1` from `Math.random()`, so `deriveCity` was not deterministic (10 253 vs 10 240 lots, all
  different). The determinism `assert.deepEqual` over the whole city then failed, and rendering the
  diff of two ~10k-building objects is the likely memory sink (2.3–2.4 GB in seconds). Fixed to
  `rng.next()` (done directly by the main session, before orchestrator mode was on).
- The handoff's proposed guard (max lots per edge/block) is unnecessary: `MAX_LOTS_PER_EDGE`
  already exists and lot generation alone stays at ~165 MB for all 267 corridor blocks.
- Determinism checks: compare a streamed digest, report only the first differing path (bounded
  message); skipped unless `TRANSITO_DETERMINISM=1`; `npm run test:determinism` runs them one
  file at a time under the 1.5 GB cap. No CI exists, so opt-in is the only switch.

## Test hunt results

| File | Result | Peak RSS |
|---|---|---|
| streets-frontage-lots, streets-parcels, world-data | pass after the fix (12, 11, 3) | 231–270 MB |
| streets-planar-graph, streets-realism, streets-tensor-field, triggers, vehicle, world | pass | ≤ 185 MB |
| walk-graph | 1 fail: `crossing at street node 1386 of degree 2` (tito-corridor, two local streets) | 256 MB |
| street-seed | 1 fail: `avenue / seed junction nodes: 2` (needs ≥ 3) | 196 MB |

`npm run typecheck`: pass. `python tools/render_map_preview.py`: OK.

## Cards

| Card | Agent · model | Outcome | Fix rounds |
|---|---|---|---|
| C1 memory-safe, opt-in determinism checks | general-purpose (implementer brief) · sonnet | done, verified by orchestrator (scope, typecheck, helper tests 9/9, parcels skip/run, own M1 mutation: red at 228 MB with `deriveCity(real area) differs at buildings[372].center.x`, restored byte-identical, green) | 0 |

## C1 result

- `tests/determinism.ts` (digest + first-difference path, bounded message), `tests/determinism.test.ts` (9 tests, always run), 7 real-area tests converted, `npm run test:determinism` (~16 s, one file at a time).
- Agent mutation table: M1 (frontage-lots), M2 (generate.ts), M3 (walk-graph.ts) each red at 198–284 MB with ~100-char messages, green after restore, restored files byte-identical.

## Open items

- walk-graph node 1386 failure: possibly the same avenue/seed junction problem as street-seed;
  unproven. Handoff step 3.
- `tools/.dbg-tmp.ts` stray still on disk.
- `npm test` runs every file concurrently with no heap cap; not changed (director runs specific
  files locally).
