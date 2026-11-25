# Map Studio: an agent workflow

An agent edits the map through the CLI (one JSON request on stdin, one JSON response on stdout, exit 0 only when `ok`).
Working edits persist in `.cache/studio/working.json` between calls; nothing touches `specs/` until `save`.

```
echo '<request>' | node tools/map-studio.ts
```

## 1. Learn the controls

```
{"op":"describe"}
```
`data.parameters` lists every path with default, `doc.min/max/unit/desc`; `data.districtPresets` the presets; `data.jsonSchema`
validates a config. (≈70 KB: read it once.) `{"op":"inspect"}` gives anchors, ridges and the resolved config.

## 2. Try before committing (dry run)

```
{"op":"patch","dryRun":true,"changes":[{"path":"procedural.towns.items[id=la-ciudad].target_km2","value":1.9}]}
```
→ `ok: true`, `changed: [{path, before: 1.8, after: 1.9}]`, `metrics.urbanKm2` 3.39 → 3.49, `violations: []`,
`data.wouldBecomeRevision`. Nothing is kept. Repeat without `dryRun` (and with `"expectedRevision"` set to the `revision` you
last read, so a concurrent edit is refused) to apply it.

## 3. Read refusals as information

```
{"op":"patch","dryRun":true,"changes":[{"path":"procedural.lake.target_km2","value":5.8}]}
```
→ `ok: false`, `errors: ["conflict — routes-connected: route gamboa-road does not reach its end stops. The last valid state is kept."]`.
The lake floods the `gamboa` stop (5.2 and 5.5 are refused too; the authored 5.0 is the edge, 4.5 is accepted). Lower it, or move the stop (`move-anchor`) and re-check. Other refusals:
`procedural.lake.target_km2: 50 is above the maximum 15 km²` (range), `canal:pacific is a hard anchor of the approved map; pass
"force": true to move it` (pinned). Never pass `force` without the director's say-so.

## 4. A composed change

1. `{"op":"add-district","preset":"paitilla-pacifica-towers","at":[3300,1000],"dryRun":true}`, then without `dryRun`.
2. `{"op":"set-district","id":"la-ciudad","targetKm2":1.9}`.
3. `{"op":"diff","against":"base"}` → changed paths and metric deltas (`districtsKm2`, `urbanKm2`, `townsKm2`, …).
4. `{"op":"validate","cell":20}` → the guards at the authored cell. A 40 m pass is a preview: some edits only fail at 20 m.
5. `{"op":"preview","cell":20,"metresPerPixel":10,"out":".cache/studio/preview.png"}` and look at it.
6. `{"op":"save"}` validates at 20 m and writes `specs/map/procedural-edits.json`. Then `npm run isthmus` renders the map
   with the edits and `npm run build` bakes it. `{"op":"reset"}` drops the working edits.

## Rules

- One concept per patch; use `dryRun` first; pass `expectedRevision`.
- Terrain edits touch everything, town edits touch towns → transit → districts, station and district edits never recompute
  terrain, roads or towns (`map-studio-causality.md`): pick the narrowest control that does the job.
- Starter districts are not in `world.yaml`: placing them is the director's decision.
- Report the real response (`errors`, `violations`), never "it should work".
