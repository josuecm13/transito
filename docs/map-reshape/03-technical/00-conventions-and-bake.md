# 03.00 — Conventions, layer contract, reference bake, warp tool

## Layer contract

| Rule | Detail |
|---|---|
| Pure function | `layerN(spec, refs, outputs of layers < N) -> LayerNOutput`. No I/O, no clock, no `Math.random` |
| Reads earlier only | Enforced by a test that builds layer N with later layers' outputs removed (mutation check: make layer 2 import layer 5 output; the test must go red) |
| Spatial index | Whole isthmus: coarse grid `cell_far: 16` m (375 x 500 = 187,500 cells over 6 x 8 km). Active area keeps the existing `relief.grid.cell: 4` m. The coarse and fine grids share origin (0,0); queries pick the finer one when it covers the point |
| Final height | `H = H0 + carve_rivers + carve_canal + flatten_airports` then street grading (existing). Layer 2 outputs `H0` |
| Budget | whole-isthmus layers 1-5 under about 1.5 s cold in node (estimate; layers 6-9 keep today's 1.5 s limit and 0.27 s measured) |

## Reference bake (offline, committed small, never fetched at runtime)

| Item | Spec |
|---|---|
| Location | `specs/map/refs/<id>.json` with `provenance`: source, query text, date, licence, "© OpenStreetMap contributors", `bbox` |
| Tool | `tools/bake-refs.mjs` (new; Overpass JSON via `fetch`, simplify Douglas-Peucker 20 m, byte-identical rerun) |
| Content | polylines of Interamericana chain, Autopista Panamá-Colón, Corredor Sur/Norte, Cinta Costera, canal, main rivers, runways; lake outline; a few hundred KB total |
| Dependency | none for Overpass; GeoTIFF reader only if land cover from WorldCover is approved |
| Use | metrics (tortuosity, spacing, junction counts) computed from the **unwarped** refs and frozen into `specs/map/refs/metrics.yaml`; preview overlays |

## Anchor table and warp tool (dev-time only)

```yaml
# proposed: specs/map/anchors.yaml  (real -> map pairs, the single source for warps and metric overlays)
anchors:
  - { id: bridge-of-the-americas, real: [-79.564, 8.944],  map: [1300, 400]  }
  - { id: casco-viejo,            real: [-79.5347, 8.9525], map: [2400, 400]  }
  - { id: miraflores-locks,       real: [-79.5906, 8.9975], map: [1400, 1500] }
  - { id: tocumen-terminal,       real: [-79.386, 9.071],   map: [5600, 1700] }
  - { id: colon,                  real: [-79.9, 9.359],     map: [1750, 7050] }
  - { id: gatun-locks,            real: [-79.918, 9.27],    map: [500, 6500]  }
  - { id: gamboa,                 real: [-79.7, 9.12],      map: [1300, 3600] }
```

| Step | Detail |
|---|---|
| Frame | real (lon,lat) -> metres `e=(lon+79.5)*109.7e3`, `n=(lat-9.05)*111e3` (equirectangular, as the probe) |
| Warp | piecewise-affine over a Delaunay triangulation of anchors (pure TS, about 120 lines); fallback TPS only for overlays |
| Checks | (1) every triangle determinant > 0 (no fold), else report the triangle and anchors; (2) after warp, report fraction of points outside `geometry.land` and distance; (3) anchors must lie on the feature they name |
| Output | overlay SVG in the preview + first-draft polylines the director edits. Nothing written to `world.yaml` automatically |
| Test | fold check on a synthetic anchor set with one swapped pair: must report the fold (mutation check) and pass on a consistent set. **Known result**: the 11 anchors in `../02-alternatives/approaches.md` fold in 7-18 triples |

## Test conventions

Every guard is mutation-checked (break what it protects, see red, restore, see green) and the report says so. Bands are
`[min, max]` around a real reference, with the source in the test name. Layers 1-5 tests live in `tests/layers-*.test.ts`
(proposed names), pure, run capped (`node --max-old-space-size=1536 --test --test-timeout=120000`), one file at a time.
