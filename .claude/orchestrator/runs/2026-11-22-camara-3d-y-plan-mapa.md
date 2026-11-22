# Run 2026-11-22 (session 3) — cámara 3D (#9) + plan del mapa (track B)

## Goal

1. Issue #9: cámara en tercera persona, alternable en Ajustes, controles "como GTA V en PC"
   (pedido del director).
2. Track B del plan de reshape del mapa, con las decisiones nuevas del director.

## Director decisions (2026-11-22, this session)

- **The current map shape (land / coastline) stays.** What gets generated is everything on top:
  relief, rivers, canal, jungle, airports, main roads, secondary roads, streets, blocks, buildings.
- Generation order (layers): jungle / land cover → elevation → rivers + Panama Canal → main roads
  (Interamericana, transístmica) → secondary roads → streets → blocks → buildings.
- Scope: nature + main roads over the whole isthmus; secondary roads and barrio streets only in the
  active area (needs an edit to CLAUDE.md rule 5 — to propose).
- Sources: investigate how Rockstar approximates real places; use OSM data as references; real
  compressed geometry "might help" (evaluate, don't assume).
- Camera controls: "like GTA 5 PC".
- Added mid-run: find Panama City's signature places, how they integrate into the map structure, and the coastway (Cinta Costera) → folded into B1.

## Cards

| Card | Agent · model | Outcome | Fix rounds |
|---|---|---|---|
| C1 cámara 3D (#9) | general-purpose · sonnet (implementer rules inlined; project agent types not loaded in this session) | done — orchestrator re-ran typecheck + 8 test files (all pass); 9 mutation checks reported (1 equivalent mutant). Not seen in a browser yet: horizon/fog in 3D, Esc under pointer lock, occlusion | 0 |
| B1 plan reshape steps 2–4 (+ Panama City places, Cinta Costera) | general-purpose · sonnet (docs only, light) | done — 21 docs under docs/map-reshape/ (02 alternatives, 03 technical ×12, 04 features: 5 issues / 24 features); recommends C hybrid; 12 director questions in 02-alternatives/recommendation.md. Orchestrator verified: files exist, specs/src/CLAUDE.md untouched by it, cable-bridge vs canal offset (~562 m) and ≤100 m sea south of Casco tip recomputed from world.yaml. Fold test (18/165 flips) is the agent's computation, partly on remembered anchors — not re-run | 0 |

## Open items

- Track A (street seed junction failure, walk-graph crossing at node 1386, relief calibration)
  still pending; the director's "generate the roads fresh" may supersede part of it — ask.
- Screenshots for #9 are taken by the main session (agents never start browsers).

- B1 questions 1–12 await the director (see recommendation.md). Rockstar sourcing is thin: one primary interview, rest journalism/fan snippets.
