# 2026-11-24 — issues review + #14 (lean)

## Verified state
- main ahead of origin by 2 (be4ad0f, 9fc6c59), not pushed. Tree dirty only in package.json, src/main.ts (cosmetic, left alone).
- Open: #14 (fixed in tree, uncommitted), #12 (2.5 F3–F6 landed locally; open comments: growTowns areasKm2, smoothAvoiding segments, Línea 2 topology, visual gaps, brown-ground/sea-under-cliff seam), #13 Map Studio (blocked by #12 2.1 per its order), #11 debug start + LOD, #9 camera (needs director browser test), #1–#6 act milestones.

## Card T1: #14 tito-home off the carriageway
Check: `node --max-old-space-size=1536 --test tests/proc-act1.test.ts` + typecheck + validator.
Result: green 12/12; mutant (drop clearOf arg) red: "interamericana: home 5.3 m from its centreline, needs 15.0"; restored green. Anchor (4285,1273) → home (4270,1290).
Files: src/world/proc/landmarks.ts (snapClearOfRoads), isthmus.ts (clearOf from streetProfiles), tests/proc-act1.test.ts.
Also green: proc-game-spec, slice, spec, proc-isthmus; tsc 0; render_map_preview OK.

## Lessons
- redone: zsh doesn't word-split `$T`; a stored test command silently printed nothing. Use a shell function.
- rule: guard output filters (`grep`) must be shown to match something before trusting an empty result.
