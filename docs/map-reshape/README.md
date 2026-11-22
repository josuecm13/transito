# Map reshape — index

Reshape the Act 1 segment, and the frame around it, from "a rectangle filled with streets" into
terrain-led geography. Relief, rivers and mountain separators decide where towns can exist, and
open-world compression techniques make the compressed isthmus read bigger than its 48 km².

**Status:** planning. Nothing here is a spec decision until the director approves it and it moves
into `specs/`.

## How to read this folder (load on demand)

Every folder has a short `README.md` with a summary and links. Read the README first, then open
only the file you need. Never load the whole tree at once.

| Step | Folder | Answers | Read when |
|---|---|---|---|
| 0 | [`00-brief.md`](00-brief.md) | What the director asked for; constraints; success criteria | Always first |
| 1 | [`01-investigation/`](01-investigation/README.md) | What exists today, what the real geography is, what the reference techniques are | Before proposing or changing anything |
| 2 | [`02-alternatives/`](02-alternatives/README.md) | Possible approaches, compared, with a recommendation | When choosing a direction |
| 3 | [`03-technical/`](03-technical/README.md) | The maths and utilities that make the chosen approach replicable (one file per utility) | When implementing or testing a utility |
| 4 | [`04-features/`](04-features/README.md) | The feature list: ids, priority, dependencies, acceptance criteria | When planning or picking up work |

## Director decisions of 2026-11-22 (override the brief where they conflict)

1. The current map shape stays (`geometry.land`, 6 x 8 km, islands); rotation/reshape ideas are dropped.
2. Generate in layers, each reading only earlier ones: jungle/cover, relief, rivers + canal, airports, main roads, secondary roads,
   streets, blocks, buildings.
3. Layers 1-5 over the whole isthmus, 6-9 only in the active-act area (needs a CLAUDE.md rule 5 change: proposed wording in
   [`02-alternatives/recommendation.md`](02-alternatives/recommendation.md), not applied).
4. Sources: Rockstar approximation, open data as offline references, evaluation of warped real geometry.
5. Panama City signature places and the coastway (Cinta Costera) are investigated and fed into main roads + anchors.

## Decisions pending (director): decided, see below

Decided 2026-11-22, except question 12 (CLAUDE.md rule 5 wording, still pending the director). The twelve questions are argued in
[`02-alternatives/recommendation.md`](02-alternatives/recommendation.md), section "Questions for the director"; the answers are in
[section "Decided (2026-11-22)"](02-alternatives/recommendation.md#decided-2026-11-22).

## New files (2026-11-22)

| File | Content |
|---|---|
| [`01-investigation/README.md`](01-investigation/README.md) | Index of the investigation |
| [`01-investigation/rockstar-approximation.md`](01-investigation/rockstar-approximation.md) | GTA V / SA approximation techniques, sourced |
| [`01-investigation/open-data-sources.md`](01-investigation/open-data-sources.md) | Offline reference datasets: licence, size, bake, dependency |
| [`01-investigation/panama-city-signature-places.md`](01-investigation/panama-city-signature-places.md) | City places, bayfront structure, map positions |
| [`02-alternatives/approaches.md`](02-alternatives/approaches.md) | A / B / C pipelines, warp evaluation |
| [`02-alternatives/recommendation.md`](02-alternatives/recommendation.md) | Recommendation, claims checked, rule 5 wording, questions |
| [`03-technical/README.md`](03-technical/README.md) | One file per layer utility plus conventions and anchors |
| [`04-features/README.md`](04-features/README.md) | Five issues and the feature list with acceptance criteria |
