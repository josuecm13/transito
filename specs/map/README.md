# Map conventions

`world.yaml` is the source of truth. This file explains how to read it.

## Coordinate system

- Units: **meters**.
- Origin `(0, 0)`: **south-west corner** of the map.
- `+x` = east, `+y` = north. Elevation is `z` (meters above sea level).
- Bounds: `x ∈ [0, 6000]`, `y ∈ [0, 8000]` → **48 km²**.

## Two layers: budget vs. geometry

- **`grid`** is an **area budget**, nothing more. It says which district owns roughly which km².
  It is never drawn and no border in the game follows a grid line.
- **`geometry`** is what the player sees: the coastline (`land`), the irregular
  `playable_boundary`, `islands`, and `routes`. District borders in the final map follow roads,
  rivers, ridges and shorelines.

## Why the map won't read as a rectangle

1. **The coasts are the shape.** The box's north and south edges are sea. The land is a bent
   isthmus with peninsulas (Colón, the old quarter, Punta Pacífica), bays (Limón Bay, the bayfront
   curve), and islands (the causeway islands, Galeta point).
2. **Land edges are natural barriers, not walls.** West: river, mangrove and steep jungle. East: a
   mountain ridge. Both are wavy lines (`playable_boundary`), and beyond them the terrain continues
   at low detail with haze, so the world never visibly ends.
3. **Nothing important is axis-aligned.** The canal runs diagonally; real OSM street networks are
   rotated and curved; the highway snakes over the ridge.
4. **Water edges are soft.** Boats can go out to the box edge, where haze and a current push them
   back. The box is never visible as a line.
5. **The in-game map is a cropped, tilted paper map** of the land silhouette, not a square tile.

## District grid (budget)

The budget is divided into 1 km × 1 km cells — 6 columns × 8 rows. Each cell is assigned the
**dominant** district it belongs to. Area per district = number of cells.

In `world.yaml` the grid is written as text, **north row first** (as it reads on screen):

```
row 0  (y 7000–8000)   S C C S S S
row 1  (y 6000–7000)   C C C J J S
row 2  (y 5000–6000)   L L L J J J
row 3  (y 4000–5000)   L L L L J T
row 4  (y 3000–4000)   G G L J T T
row 5  (y 2000–3000)   B G K K T T
row 6  (y 1000–2000)   B B K K E A
row 7  (y    0–1000)   S B K S E A
                       0 1 2 3 4 5   column (x = col × 1000)
```

Cell `(col, row)` covers `x ∈ [col·1000, col·1000+1000)`, `y ∈ [(7−row)·1000, (8−row)·1000)`.

## Area budget

| Code | District | km² |
|---|---|---|
| C | Colón and Atlantic port | 5 |
| L | Gatún Lake | 8 |
| J | Jungle ridge and transit corridor | 7 |
| G | Central canal (Gamboa, the cut) | 3 |
| B | Pacific locks and Balboa | 4 |
| K | City core | 5 |
| E | Costa del Este | 2 |
| T | Tito's corridor | 5 |
| A | Tocumen airport | 2 |
| S | Open sea (Caribbean / Bay of Panama) | 7 |
| | **Total** | **48** |

Playable land + lake: **41 km²**, about 85% of the GTA V reference figure of 48 km².

## Compression

Real-world distances are compressed non-uniformly:

| Zone | Ratio | Reason |
|---|---|---|
| City core, Costa del Este | ~1:3 | Most missions; street layout must stay legible |
| Tito's corridor, airport, Colón | ~1:4 | Dense but repetitive |
| Canal, lake, jungle | ~1:10 | Scenic, cheap to build, fast to cross |

## Geographic rule we keep on purpose

The canal's **Atlantic end lies west of its Pacific end** — true in reality, and preserved here
(Atlantic locks at x ≈ 500, Pacific locks at x ≈ 1400). Players who navigate by "Atlantic = east"
get it wrong.

## Streets

Street network model (issue #7). Data lives in `world.yaml` → `street_styles`; frozen reference
metrics live in `street-metrics.yaml`.

- **Avenues are hand-drawn.** `routes` of kind `arterial` / `highway` are fixed constraints: the
  generator never moves them; generated streets join them in T or X junctions.
- **Collectors, locals and alleys are generated** between the avenues, with widths from
  `street_styles.hierarchy` (same `{ width, sidewalk }` shape as `street_profiles`; alleys have no
  sidewalk). Each active-area land district picks a style:
  - `formal` — streamlines of a tensor field summed from basis elements (`grid` with an angle,
    `radial` around a point, `coastline` parallel to `geometry.land`), spaced per class by
    `spacing`.
  - `informal` — organic growth (segments grow, branch, snap to nearby nodes/edges, prune acute
    angles, spawn alleys), tuned by `growth`.
- **Blocks are derived**, never drawn: they are the faces of the planar street graph (after snap,
  merge, split at crossings, prune). Buildable area = block minus (half the street width +
  sidewalk) on each bordering street. Buildable area is split into parcels; each parcel fronts a
  street and gets a building.
- **Land use:** `land_use.park` / `land_use.court` are the fractions of a district's blocks that
  become parks / courts (green, no buildings). Each in [0, 1], sum < 1.
- **Deterministic:** same `street_styles.seed` + same spec → identical streets, blocks, parcels.
- **Realism is tested, not eyeballed.** Each district lists `reference` sectors: real places, as a
  lon/lat `bbox` or a `place` + `size_m` square, at most 2 km² unless pinned to an existing engine
  import by `import_area_id`. Their metrics (block size quantiles, dead-end / T / X node shares,
  intersections and street km per km², mean segment) are frozen in `street-metrics.yaml` with
  provenance (`import_area_id`, `bbox`, `place_name`, `km2`, extraction date, source, method,
  "© OpenStreetMap contributors"). The generated network must fall inside the `band` around its
  reference. A district may opt out only with `realism: exempt` plus a written `realism_reason`.
- **Real streets are never imported at runtime.** Reference sectors are measured offline from the
  `geospatial-reconstruction-engine` database (OSM); the game only reads the frozen numbers.
- **Refreshing the references:** `npm run references` (`tools/reference-sectors.mjs`) reads every
  `reference` sector, reuses the engine import whose id (`import_area_id`) or exact bbox already
  exists (no re-import), otherwise requests it (`POST /import-areas`, background, following its
  events), measures `map-data?mode=filter` with `src/world/street-metrics.ts` and rewrites only
  `references:` in `street-metrics.yaml` (`method: map-data`). Needs the engine running at
  `ENGINE_URL` (default `http://localhost:58000`); a second run with no spec change leaves the file
  byte-identical.

## Naming

Until open question #3 is decided, places use working names; the real place that inspired each one
is recorded in `inspired_by`.

## Streaming (for later)

Engine chunks are 250 m tiles → 24 × 32 = 768 tiles. Chunk ids derive from coordinates; districts
are metadata on tiles, not load units.
