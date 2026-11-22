# 01 — Investigation (index)

Hypotheses and measurements. Nothing here is a spec decision. Director decisions of 2026-11-22
(current silhouette stays; generation by layers; scope; sources) override anything in these files
that conflicts, notably the "rotate the corridor 63 deg" idea in `real-geography.md`.

| File | One line |
|---|---|
| [`current-map.md`](current-map.md) | Where the Act 1 rectangle is baked into code, what exists (coast, relief, street seed, frontage lots), measured Act 1 numbers. Snapshot of 2026-11-21 (in-flight values have moved, see 02 recommendation, "Claims checked"). |
| [`real-geography.md`](real-geography.md) | Real isthmus and corridor measured from AWS terrain tiles and OSM: rivers, apron, hill wall, per-axis compression, towns vs slope. |
| [`san-andreas-techniques.md`](san-andreas-techniques.md) | 17 perceived-size techniques of San Andreas with proposed measurable bands. |
| [`generation-techniques.md`](generation-techniques.md) | Literature toolbox: distance-field terrain, D8 rivers, suitability, slope-cost roads, barrier-aware regions, validation maths. |
| [`rockstar-approximation.md`](rockstar-approximation.md) | How Rockstar approximated real places (SA, GTA V): what was kept, compressed, simplified; sourced, fan speculation marked. |
| [`open-data-sources.md`](open-data-sources.md) | Offline reference datasets (Geofabrik, Overpass, water polygons, WorldCover, GLO-30, terrain tiles, HydroRIVERS): licence, size, bake method, dependency. |
| [`panama-city-signature-places.md`](panama-city-signature-places.md) | Signature places of Panama City, what makes them readable top-down, where they land in the existing map, and the resulting bayfront structure. |
| [`procedural-techniques.md`](procedural-techniques.md) | **2026-11-22, supersedes the "authored-first" toolbox for the macro map:** the vision built from functions: uplift + stream-power erosion, flooded reservoir, cheapest-excavation canal, flattest airport site, slope-cost roads, town growth, metro and railway; formulas, functions in `src/world/proc/`, mutation-checked guards. |
| [`assets/`](assets/) | Probe outputs: `macro-isthmus.png`, `macro-corridor.png`, `macro-summary.json`. |
