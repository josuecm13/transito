# Architecture

```
src/world/    pure: spec parsing, geometry, street network + city (streets/), walk graph. NO three/rapier/DOM.
src/sim/      pure gameplay logic (movement, followers, population, triggers, camera math). NO three/rapier/DOM.
src/ecs/      miniplex world, component types, System and Plugin contracts
src/engine/   adapters: renderer (three), physics (rapier), input (DOM), loop
src/plugins/  features composed from sim + engine through the ECS
src/ui/       DOM overlay
src/main.ts   composition root
tests/        node:test tests for src/world and src/sim
```

## Dependency rule

Arrows only point inward:

- `plugins` -> `ecs`, `engine`, `sim`, `world`
- `sim` -> `world`
- `world` -> nothing

`world` and `sim` never import `three`, `@dimforge/*`, `miniplex`, `engine`, `plugins`, `ui` or `ecs`,
and never touch `document` or `window`. `tests/architecture.test.ts` enforces this.

## Plugins

Each feature is a `GamePlugin` that registers its entities and systems into the ECS world.
`main.ts` is just the list of plugins.

## Runtime

Frame phases (`src/engine/game.ts`; fixed step 1/60 s, max 5 steps/frame, frame dt clamped to 0.1 s):

```
input -> [ fixed systems -> physics.step ] x N -> update -> late -> render systems -> view.render()
```

Systems run in plugin order (dependencies first, see `orderPlugins`), then registration order.

Contracts (`src/ecs/plugin.ts`, `src/ecs/services.ts`):

- `GamePlugin { name, dependsOn?, setup(ctx) }` - setup may be async; a throwing setup is shown in the UI and rethrown.
- `System { name, phase, run(ctx, frame) }` - registered via `ctx.addSystem` during setup.
- `GameContext { ecs, services, input, physics, view, ui, addSystem }`.
- `ServiceKey<T>` from `createServiceKey<T>(name)`; `ctx.services.provide/get/has`.

```ts
export const clock: GamePlugin = {
  name: 'clock',
  setup(ctx) {
    const Clock = createServiceKey<{ t: number }>('clock');
    const state = { t: 0 };
    ctx.services.provide(Clock, state);
    ctx.ecs.add({ position: { x: 0, y: 0, z: 0 } });
    ctx.addSystem({ name: 'clock', phase: 'update', run: (_c, { dt }) => { state.t += dt; } });
  },
};
```

Rule: plugins talk through the ECS and services, never by importing another plugin's internals.
Shared service keys live in a neutral module (e.g. `src/ecs/` or the owning plugin's public `index`).

## World data

Pure pipeline in `src/world/` (`buildWorldData(rawYaml)` in `world-data.ts`):

```
world.yaml -> parseWorldSpec -> sliceWorld -> generateStreets -> deriveCity -> buildWalkGraph -> WorldData
                                              (streets/: graph    (blocks -> buildable -> land use
                                               + blocks)           -> parcels -> buildings)
```

`WorldData = { spec, slice, streets, city, buildings, walkGraph }`:

- `streets: StreetNetwork` (`streets/generate.ts`): planar street graph (avenues fixed from the spec,
  collectors / locals from tensor-field streamlines, alleys from organic growth, plus `frame` edges
  along coast and borders) and its bounded faces, the blocks.
- `city: City` (`streets/city.ts`): per block buildable area, land use, parcels and buildings.
- `buildings = city.buildings` (`CityBuilding` = blockout `Building` + parcel and block ids).
- `walkGraph` (`walk-graph.ts`): sidewalks of every street with sidewalk (both sides, joined at
  corners, wrapping dead ends), alley centerlines, and `crossing` edges across every arm at each
  intersection. Built on `joinTouchingDeadEnds(streets.graph)`; `origin[i]` is the street node a
  walk node belongs to. Nothing walkable lies on a carriageway except crossings.

Plugins render it (three), build colliders from it (rapier) and walk pedestrians on `walkGraph`; they
never regenerate it. Same yaml -> deep-equal `WorldData`; the active area builds in about 1.1 s in
Node (`tests/world-data.test.ts` keeps it under 1.5 s).

Rule: fixed rng draw order per candidate. Generators draw every random number a candidate needs
(e.g. buildings: fill, width, depth, height) before any rejection rule runs, so adding or changing a
rejection rule never shifts the randomness of others. Each district / pass / block uses its own
labelled rng fork.

## Screens & pause

Pause is a set of reasons, not a boolean (`ecs/pause.ts`, `ctx.pause`): `pause(reason)` / `resume(reason)` are
idempotent per reason and the game is paused while at least one reason is held. The `screens` service holds
the reason `'screens'` while its stack is non-empty.

What runs per frame (`engine/game.ts`; clock and accumulator logic in the pure `sim/frame-gate.ts`):

| Phase / step         | Running | Paused |
| -------------------- | ------- | ------ |
| `input` systems      | yes     | no     |
| `fixed` + physics    | yes     | no     |
| `update` systems     | yes     | no     |
| `late` systems       | yes     | yes    |
| `render` + `view.render()` | yes | yes  |

While paused, held keys are cleared every frame. On the paused -> running transition the frame clock and the
fixed-step accumulator are reset, so there is no catch-up burst. `elapsed` only advances while running.

`ScreensKey` (`plugins/keys.ts`) exposes `ui/screens.ts`: a modal stack (`open/back/closeAll/top`), menu entries
and shortcuts. One window `keydown` listener: the top screen's `onKey` first, then `Escape` (opens `pause-menu`
or goes back), then registered shortcuts (toggle). Window blur / hidden tab opens `pause-menu`.

Contribution pattern: a plugin that `dependsOn: ['screens']` adds its feature without the pause menu knowing it:

```ts
const screens = ctx.services.get(ScreensKey);
screens.register({ id: 'world-map', title: 'Mapa', mount, unmount, onKey });
screens.addMenuEntry({ label: 'Mapa', order: 10, action: () => screens.open('world-map') });
screens.addShortcut('Tab', 'world-map');
```

`pause-menu` lists "Continuar" (order 0), every contributed entry sorted by `order`, and "Controles" (order 100).

## World view

`world-view` draws the whole city ground as **one** merged mesh (`engine/meshes.ts` `groundMesh`,
vertex colours, one draw call): block ground by land use (neutral; parks, court blocks and medians
green), court rectangles with painted lines (`world/court-layout.ts`), runways / rails / canals from
`slice.streets`, then sidewalks, carriageways by class (alley, local, collector, avenue) and centre
lines from `world/street-surface.ts` (pure triangle soups from `streets.graph`: one band per edge,
exact circular joints on the open side of bends and dead ends, full discs at junctions). Sea, land and
the city ground are drawn first, in that order, without depth writes, so each layer paints over the
previous one and coplanar layers never z-fight; buildings (one `InstancedMesh`, tone by land use),
characters and markers write depth as usual. The debug HUD shows FPS, draw calls and triangles.

## Vehicle

- `sim/vehicle.ts` (pure, tested): arcade car model, signed speed + yaw + steering wheel; throttle, brake
  that reverses once stopped, rolling drag, speed-scaled turn rate (inverted in reverse), handbrake;
  `contactSpeed` feeds the real displacement back so a wall kills the speed. `world/parking.ts` (pure,
  tested) picks the start spot: right-hand kerb of a drivable edge near the spawn, clear of buildings and
  other carriageways.
- `plugins/vehicle.ts`: kinematic Rapier cuboid moved with a character controller (shape-cast, slide), like
  Tito, so there is no dynamic vehicle at 5 km coordinates; turning is refused when the rotated box would
  hit something. E enters/exits (exit under 3 m/s at a free spot beside the driver door): the car takes the
  `cameraTarget` / `populationFocus` tags, Tito gets `inVehicle` (his collider off, `player-move` idle) and
  his body follows the car, so minimap, world map and landmark triggers keep reading the `player` entity.

## Minimap

`ui/minimap-layer.ts` renders the whole active area (sea, land, blocks by land use, courts, streets by
class with their sidewalks, buildings) into one offscreen canvas once at startup. Each frame the `minimap` plugin crops it around Tito with a
single `drawImage` and draws landmark dots and the heading arrow on top. The pure projection
(north-up mapping, edge clamping, yaw to canvas angle) lives in `sim/minimap.ts` and is tested.

## World map

The `world-map` plugin contributes itself through the `screens` service: it registers the `world-map`
Screen, a "Mapa" pause-menu entry (order 10) and the `Tab` shortcut. While mounted, keydown arrives through
the Screen's `onKey`; keyup, blur, resize, wheel and pointer listeners are its own and all share one
`AbortController`, so unmount removes them with a single `abort()` (and cancels any pending frame). The
game is paused meanwhile and `ctx.input` is cleared, so the map never reads it.

- Pure view math in `sim/map-view.ts` (tested): north-up transform, `fitBounds`, `zoomAt` (cursor point
  stays fixed, clamped), `pan`, `clampCenter`, the 1-2-5 scale step and greedy label placement.
- Drawing in `ui/world-map-canvas.ts`: land + islands from `geometry`, the area beyond
  `playable_boundary` hatched (and continuing past the west/east box edges, fading out), the active area
  from `renderStaticLayer` (built on first open, cached) clipped to `slice.rect`, district and water names
  (`districtLabelPoint`: `label_at`, else the district's central grid cell, as in the map preview tool).
  Redraws are on demand, coalesced to one animation frame; the frame loop only runs while a pan key is held
  or a keyboard zoom eases. Tito's pulse is a DOM ring animated by the browser, not a redraw loop.
- Spoiler rule: outside the active area only the silhouette and spec names are drawn; landmarks come only
  from `slice.landmarks`, so other acts' places never appear.

## Dev harness

`player-lab.html` + `src/dev/player-lab.ts` boot the game with a hand-picked plugin list
(world, physics, camera, player, landmark triggers, HUD) without touching `main.ts`. Run
`npm run dev` and open `/player-lab.html`. `?spawn=<landmarkId>` starts the player at that landmark
(must exist in the active slice) so QA can jump straight to it. It is not part of `npm run build`.

`peds-lab.html` + `src/dev/peds-lab.ts` boot world + camera + `pedestrians` + HUD with no player (the
population focus falls back to the spawn landmark). A `#peds-debug` readout (alive, physical, blocked,
max distance from focus) is lab-only. `?walk=1` adds a stand-in focus that walks south along the avenue so
the physics LOD gets exercised. Pedestrian pipeline: `sim/population` (spawn ring, budget, despawn) ->
`sim/follower` (rides the walk graph, keeps right) -> `sim/avoidance` (stop when blocked); far agents are
ghosts, agents within `physicalRadius` of the focus get a kinematic capsule.
