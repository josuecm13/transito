# 00 — Brief

## The ask (director, 2026-11-21)

- Reshape the Act 1 segment. Its current shape is literally a rectangle that is filled with
  streets (`active_area.rect` x∈[4000,6000], y∈[0,4000]).
- Generate segments in a more realistic way: **relief dictates the limits of towns**, not a box.
- Add **rivers**.
- Add **mountains that separate** towns and regions.
- Use the open-world techniques of **GTA: San Andreas** to make the map feel bigger than it is.
  This is the crucial part.
- Deliver it as a set of documents: investigation → alternatives → technical utilities that make
  it mathematically replicable → feature list, in a folder that is read on demand.

## Constraints (from CLAUDE.md and specs/)

- **Original content.** Learn techniques from San Andreas (scale tricks, separators, sightlines,
  density gradients). Never copy its map, layout, names, landmarks or assets. Real Panama places
  are inspiration, recorded in `inspired_by`.
- **Specs are the source of truth.** These documents propose. Changes go into `specs/` only after
  the director approves them, and code follows the spec.
- **One act at a time.** The macro frame (coast-to-coast silhouette, mountain separators, river
  network) can be defined for the whole map, but only the Act 1 segment gets detail. Everything
  else stays grey or low detail.
- **Deterministic.** Same seed + same spec → same world. Every generator is a pure function of the
  spec.
- **Realism is tested, not eyeballed.** Every utility comes with a metric and a band, and every
  guard test is mutation-checked.
- **No runtime import of real data.** Real geometry and measurements are baked offline from the
  geospatial engine (`npm run geo`, `npm run bake-seed`) with attribution.

## Starting point (2026-11-21)

- Map: 6 × 8 km = 48 km². Act 1 active area: 8 km², a sixth of the map.
- In flight (uncommitted): terrain relief (`src/world/terrain.ts`, `relief:` in world.yaml), a
  La Carpio street seed for the corridor, a port of the engine's frontage-lots building fill, and
  the `map-from-reality` skill with 8 real fragment profiles in `specs/map/fragments/`.

## Success criteria for the plan

1. A reader can tell why each separator (river, ridge, mangrove, highway, airport fence) sits where
   it does, and what real feature inspired it.
2. Town limits come out of a computed suitability field (slope, height, water distance, flood
   risk), not out of a rectangle.
3. Each perceived-size technique is stated as something measurable (sightline length, route
   tortuosity, travel time, landmark visibility) with a target number.
4. Every utility can be reimplemented from its document alone: inputs, formula, parameters,
   defaults, test.
5. The feature list can be picked up one item at a time by the orchestrator's agents.
