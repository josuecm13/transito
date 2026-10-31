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

## Naming

Until open question #3 is decided, places use working names; the real place that inspired each one
is recorded in `inspired_by`.

## Streaming (for later)

Engine chunks are 250 m tiles → 24 × 32 = 768 tiles. Chunk ids derive from coordinates; districts
are metadata on tiles, not load units.
