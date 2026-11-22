# 01 — Open data usable as offline references

Rule kept: **baked offline into the repo, never fetched at runtime**, with attribution; the game reads frozen files.
"Dependency?" means a new npm package or system tool (new deps need the director's approval; none is assumed).
Repo today: `js-yaml`, `polygon-clipping`, `three`, `miniplex`, `rapier`; the probe `tools/probe-macro-relief.mjs` decodes
terrarium PNG with `node:zlib` only. `gdalinfo`, `ogr2ogr`, `osmium` are **not installed** on this machine (checked).
Sizes marked **[checked]** were read from the server in this pass (HEAD request / page); **[memory]** were not.

## Table

| Source | Layer it feeds | Licence / attribution | Size | Bake method (offline) | New dependency? |
|---|---|---|---|---|---|
| **Geofabrik Panama extract** `panama-latest.osm.pbf` / `-free.shp.zip` ([page](https://download.geofabrik.de/central-america/panama.html)) | Roads (main, secondary), waterways, landuse, buildings: bulk reference | ODbL 1.0, "© OpenStreetMap contributors" [checked] | pbf 35.1 MB, shp.zip 87.1 MB [checked] | One-time download to `.cache/` (gitignored), filter by bbox + tag, write small JSON into `specs/map/refs/` | pbf needs `osmium`/`osmosis` or an npm pbf parser; shp needs an npm shapefile reader. **Avoidable**: use Overpass JSON below or the existing geospatial engine |
| **Overpass API** targeted queries (`overpass-api.de`) | Interamericana / Corredores / Autopista Panamá-Colón, Cinta Costera, runways, canal, rivers | ODbL, same attribution | Small: `highway~motorway\|trunk` for the isthmus bbox = 1.1 MB JSON [checked]; runways = a few KB [checked] | `curl` + `node` script, JSON in, simplified polylines out. Public server is rate-limited: one heavy regex query returned HTTP 502 once; retry with backoff, user-agent without personal data | None (node `fetch` is enough) |
| **OSM water polygons** ([osmdata.openstreetmap.de](https://osmdata.openstreetmap.de/data/water-polygons.html)) | Coast reference check (is `geometry.land` the real shape?) | ODbL [checked] | Not stated on the page; split shapefile variant exists (full set is large, **[memory]** hundreds of MB to GB). Do not download | Not needed for the plan: coast stays as authored. Only if the director wants a coast overlay; clip to bbox | Shapefile reader |
| **OSM `waterway=river\|canal`, `natural=water`, `natural=wetland`** (via Overpass/engine) | Rivers, Gatún Lake outline, mangrove/wetland, canal | ODbL | KB to a few MB | As Overpass row. Relations (lake, wetland multipolygons) need `out geom` on relations; the investigation probe skipped relations, so large mapped areas may be missing | None |
| **ESA WorldCover 2021 v200**, 10 m, 11 classes ([AWS registry](https://registry.opendata.aws/esa-worldcover-vito/)) | Land cover: tree/shrub/grass/cropland/built/bare/water/wetland/mangrove shares and their patterning | CC BY 4.0 [checked]; credit "ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium" **[memory]** | 3 x 3 deg COG tiles: `N06W081` 25.2 MB, `N09W081` 9.8 MB [checked]; the isthmus straddles lat 9.0 so both tiles are needed. Range reads of a COG would fetch only the bbox | Download the two tiles to `.cache/`, window to lon -80.0..-79.3, lat 8.9..9.4, aggregate to shares per class (and a coarse 100-200 m class grid if wanted), freeze numbers/grid as YAML/PNG | **Yes**: a GeoTIFF/COG reader (npm `geotiff`, or system `gdal`). Alternative with no dep: ask the director for permission to use `python3` + a pip package for the bake only |
| **Copernicus DEM GLO-30**, 30 m ([AWS registry](https://registry.opendata.aws/copernicus-dem/)) | Relief reference, drainage | Copernicus licence, free for the general public [checked]; suggested citation in the registry | 1 deg COG tiles: `N09_W080` 25.0 MB, `N08_W080` 7.9 MB [checked] | Window and resample, as WorldCover | **Yes** (COG reader). **Not needed**: terrain tiles below are already decoded without a dep |
| **AWS Terrain Tiles (Mapzen terrarium)** ([AWS registry](https://registry.opendata.aws/terrain-tiles/)), already used by `probe-macro-relief.mjs` and the engine | Relief + D8 reference (already baked into `assets/macro-summary.json`) | Mapzen/joerd attribution document (terms not stated on the registry page; see the joerd attribution doc) | z10 and z13 tiles; one z10 tile PNG is 131 KB [checked] | Already scripted; cached in `.cache/macro/` | None |
| **HydroRIVERS** v1.0, 15 arcsec ([hydrosheds.org](https://www.hydrosheds.org/products/hydrorivers)) | Rivers: reach discharge, order, topology (reference for Leopold-Maddock widths) | Free for scientific, educational and commercial use under HydroSHEDS terms; attribute Lehner & Grill 2013 [checked] | North and Central America: 66 MB shp.zip / 72 MB gdb.zip [checked] | Download once, clip to bbox, keep reach polylines + `DIS_AV_CMS` (mean discharge) | Shapefile reader. Lower value than D8 on our own relief + OSM rivers; **optional** |
| **Geospatial engine already in the workflow** (`npm run geo`, PostGIS with OSM) | Streets, blocks, buildings fragments (already used) | OSM, ODbL | n/a | Existing pinned imports (`import_area_id`) | None, but needs the engine running: not started in this pass |

## Recommendation (data)

1. **Overpass JSON + the existing terrain-tile pipeline cover layers 2, 3, 5 with zero new dependencies.** Start there.
2. **Land cover (layer 1) is the one real gap**: OSM landuse is incomplete (informal areas, forest relations). WorldCover is the
   right source but needs a COG reader. Ask for approval of one of: npm `geotiff` (pure JS, dev-time only), system `gdal`, or
   skip real cover and calibrate cover shares from OSM landuse + the investigation's slope/height tables.
3. Never commit raw downloads. Commit only the reduced products under `specs/map/refs/` with a `provenance` block
   (source URL, query text, date, licence, "© OpenStreetMap contributors"), byte-identical on rerun (same convention as
   `specs/map/seeds/`).
4. ODbL note (not legal advice): baked OSM-derived geometry is a derivative database. The street seed was already accepted by the
   director as an exception. Warped polylines (alternative B) enlarge that exposure; see the questions in
   `../02-alternatives/recommendation.md`.

## Facts measured in this pass (reusable as references)

Overpass, bbox lat 8.85..9.45, lon -80.0..-79.25, `highway~motorway|trunk`, lengths summed over ways (so a dual carriageway
counts both carriageways, about 2x its centreline):

| Name (OSM) | Class | Sum of ways | Extent (lat, lon) |
|---|---|---|---|
| Autopista Panamá-Colón | motorway | 117.5 km (40 ways) | 9.04..9.346, -79.882..-79.534 |
| Carretera Panamericana | trunk | 95.4 km (197 ways) | 8.85..9.123, -79.82..-79.227 |
| Corredor Norte | motorway | 57.4 km | 8.965..9.11, -79.554..-79.391 |
| Vía Centenario | motorway | 46.0 km | 8.953..9.041, -79.662..-79.535 |
| Corredor Sur | motorway | 37.3 km | 8.977..9.069, -79.517..-79.401 |
| Cinta Costera (trunk + motorway ends) | trunk/motorway | 3.4 + 0.7 km | 8.957..8.977, -79.538..-79.516 |
| Avenida Balboa Viaducto | trunk | 1.8 km (17 ways) | 8.960..8.964, -79.542..-79.536 |
| Puente de las Américas | trunk | 1.7 km (2 ways) | 8.941..8.947, -79.571..-79.557 |

Runways (`aeroway=runway`, lat 8.9..9.15, lon -79.6..-79.3): Tocumen 03R/21L 3,056 m and 03L/21R "Northern Runway" 2,438 m
(+252 m stub), parallel, bearing about 29 deg from north, about 850 m apart perpendicular (my computation from the end points);
an unnamed 1,504 m way at lon -79.555 (the Marcos A. Gelabert airfield, name not tagged on the way); runway 18/36, 2,603 m at
lon -79.5996 (west of the canal).
Reading: only a **named-route chain** is not enough to trace the Interamericana through the city; the offline bake must follow the
route relation or a chosen chain of ways (not verified in this pass, see `../03-technical/06-main-roads.md`).
