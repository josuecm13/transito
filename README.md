# TRÁNSITO

A top-down open-world crime story set on a compressed Isthmus of Panama — Colón on the Caribbean,
Panama City on the Pacific, the canal and Gatún Lake between them, Tocumen airport to the east.
Personal, non-commercial prototype. Original characters, story, and world.

This repo is **specs first**: characters, story, and map are defined here as documents and data
before any engine code exists. The map data (`specs/map/world.yaml`) is meant to be read directly
by the future world-generation pipeline.

## Layout

```
specs/
  story/
    premise.md          logline, pillars, the heist chain, act outline
    open-questions.md   decisions not yet made, with current defaults
  characters/
    README.md           character spec format
    valeria-ostos.md    the paper — 10 years in Panama City
    tito-abrego.md      the air — the barrio between the city and the airport
    neto-gordon.md      the sea — Colón
  map/
    README.md           coordinate system, scale, compression, grid conventions
    world.yaml          machine-readable world: bounds, district grid, landmarks, routes
    districts.md        per-district design notes
```

## Status

Pre-production. Next step: OSM + elevation pipeline that renders a 6 × 8 km blockout preview from
`world.yaml`.
