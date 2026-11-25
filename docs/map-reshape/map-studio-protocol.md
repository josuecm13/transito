# Map Studio protocol (#13)

One pure function, `handle(state, request) → outcome` in `src/studio/protocol.ts`. The CLI (`tools/map-studio.ts`) and the
page (`map-studio.html`, run in a Web Worker) both call it; neither re-implements terrain, validation or guards.

```
state    = { base: world.yaml, saved: edits, working: edits }     edits = [{ path, value }]  (differences from world.yaml)
request  = { op, version?: 1, … }
response = { ok, version, revision, changed?, metrics?, hashes?, violations?, warnings[], errors[], data? }
outcome  = { response, working?, saved?, image? }                 the host persists `working` / `saved` / `image`
```

Coordinates are metres, origin south-west, +x east, +y north (the map is 6000 × 8000 m). Paths address the `procedural:`
mapping of `specs/map/world.yaml`: `procedural.lake.target_km2`, `procedural.towns.items[id=la-ciudad].target_km2`,
`procedural.roads.stops.city`. Entries of a list are addressed by `[id=…]`, so reordering never moves an edit. An edit never
invents a parameter: the key must already exist.

## Operations

| op | What it does | Changes `working` |
|---|---|---|
| `describe` | Parameters with default, range, unit and plain-language doc; JSON Schema; ops; examples; district presets; cells | no |
| `inspect` (`generate?`) | Anchors, ridge zones, the full resolved config; with `generate` also metrics, hashes, violations | no |
| `patch` `{changes, dryRun?, expectedRevision?}` | Generic edit of one or more paths | yes |
| `move-anchor` `{anchor, to, force?}` | `stop:roads:<id>`, `stop:transit:<id>`, `seed:<town>:<n>`, `district:<id>`, `hint:airport`, `hint:dam`, `canal:<name>` (hard: needs `force`) | yes |
| `set-ridge` `{id, points?, width?, rate?, at?, radius?}` | Relief zone | yes |
| `set-district` `{id, targetKm2?, roadAffinity?, reach?, patchThreshold?}` | Town growth (the issue's "district" = town in `world.yaml`) | yes |
| `set-route` `{id, stops}` | Stops of a road route | yes |
| `add-district` `{preset, at \| along, id?, sigma?, weight?}` / `remove-district` `{id}` | District model items (presets in `describe`) | yes |
| `validate` | Runs every guard on the working map | no |
| `diff` `{against: base \| saved}` | Changed paths, metric deltas, hashes of both sides | no |
| `generate` / `preview` `{metresPerPixel?}` | Metrics + hashes; `preview` also returns the rendered image (the CLI writes a PNG) | no |
| `save` | Validates at the authored cell (20 m) and returns `saved`; the host writes `specs/map/procedural-edits.json` | `saved` |
| `export` | The resolved config and the edit list | no |
| `revert` `{to: base \| saved}` / `reset` | Drop working edits | yes |

Every edit op accepts `dryRun` (compute everything, keep nothing), `expectedRevision` (refused when the map moved) and `cell`
(generation cell in metres: default 40 m, the coarse preview). The last two are what make agent loops safe.

## Refusals: nothing is repaired silently

An edit is refused, and the last valid state kept, when:

- the path or value is invalid (unknown key, wrong type, outside the ranges of `describe`, a cross-reference the strict parser
  rejects);
- the generator cannot build the map (`generation failed: routeRoads: … unreachable`);
- it introduces a guard violation that the working map did not have (`conflict — <guard>: <message>`);
- it moves a hard anchor (canal ends) without `force`, or points outside the map;
- `expectedRevision` does not match.

The refusal is `ok: false` with the guard's own text in `errors`; `violations` and `metrics` still describe the rejected map so
the caller can see why. The CLI exits 1. In the page the same text appears in a banner and the inputs snap back.

Guards (each mutation-tested in `tests/studio-guards.test.ts`): `reservoir-connected`, `rivers-drain`, `canal-connects-seas`,
`no-towns-on-water`, `no-runways-on-water`, `airport-buffer`, `airport-detached-from-core`, `districts-airport-gap`,
`transport-crosses-water-only-on-bridges`, `routes-connected` (tolerance 200 m, `ROUTE_END_TOLERANCE_M`), `linea-2-unchanged`,
`pinned-places-on-land`, `wilderness-between-centres`.

## Cells, hashes and previews

Hashes (`height lake rivers roads towns transit districts all`) are per generation cell: a 40 m map is not a 20 m map (the
airport lands at 5170,2620 at 20 m and 5330,2780 at 40 m). Previews are approximations; **verdicts** (guards) are cell
independent for the authored map and the documented edits (see `map-studio-causality.md`). Two limits remain, both generator
behaviour, not studio behaviour:

- Some edits pass at 40 m and are unbuildable at 20 m (`relief.seed: 12`: `routeRoads: gamboa-road leg 1 unreachable`), and
  some cells fail on the unedited map (44 m and 64 m: same error; 40, 48–60, 80 pass). The page therefore validates every
  accepted edit at 20 m and rolls it back with the reason when that fails.
- `save` always validates at the authored cell unless `cell` is given (`validatedAtCell` in the response).

`evaluate` memoises the last 3 generated maps per configuration and cell, so an edit's before/after and its preview cost one
generation each (`tests/studio-memo.test.ts`).

## Files

| File | Role |
|---|---|
| `specs/map/world.yaml` | Authored map, hand-readable, with comments. Never rewritten by the studio |
| `specs/map/procedural-edits.json` | `{ "version": 1, "edits": [{ "path", "value" }] }`, sorted, minimal. Applied on top of world.yaml by the studio, `tools/render-isthmus.ts` and `tools/bake-isthmus.ts`. It is a bake input (`tools/vite-isthmus.ts`), so a Save rebakes the game's map. Absent = the authored map |
| `.cache/studio/working.json` | CLI working edits between calls (git-ignored) |

## The page

`npm run dev` then `/map-studio.html`. Large pan/zoom preview (drag to pan, wheel to zoom, drag an anchor to move it), a right
inspector with four groups (World, Land & water, Places, Connections), layer toggles, undo/redo (Cmd/Ctrl+Z), a compare slider
against the authored map, Reset, seed shuffle (🎲 beside every `seed`), numeric inputs with units from `describe`. Edits are
debounced (350 ms); a 40 m preview shows first, then the validated 20 m map; results of an older generation are ignored and
queued previews that a newer edit overtook are dropped. **Save** validates through the protocol and then writes the edits file
through a dev-server-only endpoint (`/__studio/save`); **Download edits** exists for builds without it.
Pinned anchors (red squares, canal ends) refuse to move until "Allow moving pinned anchors" is ticked in Connections.
The map extent is locked: changing it needs a rescale policy for the authored coast (open question, not built).

## Benchmarks

`node --max-old-space-size=1536 tools/bench-studio.ts` (2026-11-25, node 22, Apple silicon laptop, other apps open):

| Request | Time | RSS after |
|---|---|---|
| `describe`, `inspect` | 1–2 ms | 95 MB |
| `preview` 40 m, cold | 1.8 s | 190 MB |
| `preview` 40 m, memo warm (render only) | 0.16 s | 207 MB |
| `patch` at 40 m (one new generation) | 1.5 s | 247 MB |
| `add-district` at 40 m | 1.5 s | 255 MB |
| `preview` 20 m of an edited map | 6.3 s | 317 MB |
| `validate` / `save` at 20 m when the memo is warm | 1 ms | 317 MB |
| `save` at 20 m, cold | 5.9 s | 294 MB |
| `diff` at 40 m (two generations) | 2.8 s | 299 MB |

Peak RSS 317 MB. Generation dominates (rendering a 600 × 800 preview is ~0.2 s), which is why the page runs it in a worker.
