# Handoff: after the test hunt (2026-11-22, session 2)

Supersedes the "Interrupted" and "Next steps 1–2" sections of
`2026-11-22-map-reshape-handoff.md`; everything else there (fragments, skill, investigation
findings, pending decisions) still applies. Items marked **verified** were checked directly
against the repo at the end of session 2; everything else is a hypothesis to re-check.

## How to work

- Run as the project orchestrator (`.claude/skills/orchestrator/`): delegate, verify, report.
- Subagents: **Sonnet at most** (haiku for mechanical work); never Opus.
- Resource limits (global CLAUDE.md, "Use the machine's resources mindfully"): max 2 background
  agents, max 1 heavy; no agent dev servers or browsers; Node tests one file at a time,
  `node --max-old-space-size=1536 --test --test-timeout=120000 tests/<file>.test.ts`. Never run
  the bare `npm test` (it runs every file in parallel, uncapped).
- The working tree is a large UNCOMMITTED change set. No `git checkout/restore/stash/clean`.
  Revert temporary mutations from /tmp copies. No commits unless the director asks.

## Verified state

- **Frontage-lots memory blow-up: fixed.** `sampleDimension` (`src/world/streets/frontage-lots.ts`)
  used `Math.random()` → `deriveCity` was non-deterministic → the whole-city `deepEqual` determinism
  checks failed and rendering their diff took 2.3+ GB. Now `rng.next()`; no `Math.random` in `src/`.
- **Determinism checks are memory-safe and opt-in.** `tests/determinism.ts` (digest + first
  differing path, ~100-char message); 7 real-area tests use `determinismTest` and are skipped unless
  `TRANSITO_DETERMINISM=1`; `npm run test:determinism` runs them one file at a time (~16 s).
  Mutation-checked: a reintroduced `Math.random` fails at ~228 MB with
  `deriveCity(real area) differs at buildings[372].center.x: …`.
- **Every test file has been run.** All pass except two:
  - `tests/street-seed.test.ts` "avenues split the seed…": `avenue / seed junction nodes: 2` (needs ≥ 3).
  - `tests/walk-graph.test.ts` "real area: every crossing is at an intersection…":
    `crossing at street node 1386 of degree 2`. Node 1386 (5422.9, 3511.9) joins two `local`
    edges (sidewalk 2) in `tito-corridor`, where the La Carpio seed lands. Possibly the same
    junction problem; **unproven**.
- `npm run typecheck` passes; `python tools/render_map_preview.py` OK.
- Map reshape plan: `docs/map-reshape/00-brief.md` + `01-investigation/` (4 docs + assets) exist;
  `01-investigation/README.md`, `02-alternatives/`, `03-technical/`, `04-features/` do not.
- Relief: `src/world/terrain.ts` (508 lines), `src/world/drape.ts`, `relief:` in world.yaml (sea
  floor, coastal ramp, rolling, `hills` incl. san-miguelito, flatten, landmark pads, streets, grid,
  targets), wired into plugins/engine. No rivers in the terrain code. Calibration against the
  slope targets and a visual check: not done.

## Tracks (director chose B on 2026-11-22; A waits)

**A. Build: street seed, then relief** (heavy, one agent at a time)
1. Diagnose the two failures above: does the walk-graph crossing at 1386 come from the seed? Then fix
   the avenue/seed junctions so avenues split seed streets with nodes. Confirm corridor realism stays
   in the La Carpio band and determinism (`npm run test:determinism`).
2. Finish the relief integration and calibrate slopes against the targets in the first handoff.
3. Delete `tools/.dbg-tmp.ts` once confirmed unused.

**B. Plan: map reshape steps 2–4** (docs-only, light; can run beside one heavy agent)
- `01-investigation/README.md`, then `02-alternatives/` (2–3 approaches + recommendation),
  `03-technical/` (one file per utility: inputs, formula, parameters, defaults, test, metric band),
  `04-features/` (ids, priority, act, dependencies, acceptance criteria).
- Scale, sectors, rivers and relief are decided here; the director's open decisions (Act 1 scale,
  orientation/compression, rivers authored vs derived, gating, fog, seed anchor, realism reference)
  should be put to him as questions, not assumed.
