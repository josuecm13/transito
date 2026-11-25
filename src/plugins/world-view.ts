import type { GamePlugin } from '../ecs/plugin.ts';
import { LandCoverKey, WorldDataKey } from './keys.ts';
import { specToScene } from '../world/coords.ts';
import { clipLandToRect, drapeSoup } from '../world/drape.ts';
import { ribbon } from '../world/ribbon.ts';
import { AVENUE_KINDS } from '../world/streets/region.ts';
import { buildStreetSurfaces, ringOutline, STREET_LAYERS } from '../world/street-surface.ts';
import type { TriSoup } from '../world/street-surface.ts';
import type { CityBuilding } from '../world/streets/buildings.ts';
import { isCityBlock } from '../world/streets/city.ts';
import { courtLines, courtRect } from '../world/court-layout.ts';
import {
  MARKER_HEIGHT,
  PALETTE,
  buildingsMesh,
  addGround,
  farGroundMesh,
  groundMesh,
  landMesh,
  landmarkMarker,
  liftSoup,
  lockWallsMesh,
  ribbonSoup,
  surfaceMesh,
  triangulatePolygons,
} from '../engine/meshes.ts';
import type { GroundLayer, HeightSoup } from '../engine/meshes.ts';
import type { RiverCourse } from '../world/water.ts';
import { coverAt, densityAt } from '../world/cover.ts';
import { createWorldLabels } from '../ui/world-labels.ts';
import type { WorldLabel } from '../ui/world-labels.ts';

/**
 * Ground layer heights (m above the land at y = 0), bottom-up. Higher layers paint over lower ones
 * where they overlap (junctions: the wider street class wins), so each overlapping pair needs its
 * own height. 1 cm steps are plenty of depth precision at the H0 camera distance.
 */
const LAYER_Y = {
  block: 0.01,
  water: 0.015,
  barrier: 0.02,
  court: 0.025,
  courtLine: 0.03,
  sidewalk: 0.03,
  alley: 0.04,
  local: 0.05,
  collector: 0.06,
  avenue: 0.07,
  marking: 0.08,
} as const;

const COURT_LINE_M = 0.25;

/**
 * How finely the ground is draped over the terrain (world/drape.ts): triangles split until the
 * terrain is within `tolerance` m of the flat chord, down to `minEdge` m, never longer than `maxEdge` m.
 * The land base is only the backdrop under the city layers, so it may be coarser.
 */
const DRAPE = {
  land: { maxEdge: 48, minEdge: 8, tolerance: 0.4 },
  layers: { maxEdge: 48, minEdge: 4, tolerance: 0.2 },
} as const;

/**
 * The far ground (layers 1-2, whole isthmus at the 16 m grid) is a coarser drape: ridges and hills read
 * as silhouettes, so 1.5 m of chord error is plenty, and edges stay between one far-grid cell and 96 m.
 */
const FAR_DRAPE = { maxEdge: 96, minEdge: 16, tolerance: 1.5 } as const;

/** Water surfaces sit this far above their level so they never share a depth value with the ground they overlap. */
const WATER_LIFT = 0.05;

/**
 * A river as a triangle strip along its course (left/right per vertex, `width` wide), at its water surface height + `lift`.
 * Quads are (left_i, right_i, left_i+1, right_i+1), CCW seen from above (same as world/ribbon.ts).
 */
function riverSurface(r: RiverCourse, lift = WATER_LIFT): HeightSoup {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = r.points.length;
  for (let i = 0; i < n; i++) {
    const a = r.points[Math.max(0, i - 1)] as { x: number; y: number };
    const b = r.points[Math.min(n - 1, i + 1)] as { x: number; y: number };
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / l;
    const ny = (b.x - a.x) / l;
    const p = r.points[i] as { x: number; y: number };
    const hw = (r.width[i] as number) / 2;
    const h = (r.surface[i] as number) + lift;
    positions.push(p.x + nx * hw, p.y + ny * hw, h, p.x - nx * hw, p.y - ny * hw, h);
  }
  for (let i = 0; i + 1 < n; i++) {
    const l0 = 2 * i;
    indices.push(l0, l0 + 1, l0 + 2, l0 + 1, l0 + 3, l0 + 2);
  }
  return { positions, indices };
}

const BARRIER_SURFACE: Record<string, number> = {
  runway: PALETTE.runway,
  rail: PALETTE.rail,
  waterway: PALETTE.waterway,
};

export const worldView: GamePlugin = {
  name: 'world-view',
  dependsOn: ['world-data'],
  setup(ctx) {
    const { spec, slice, streets, city, buildings, terrain, water, cover } = ctx.services.get(WorldDataKey);
    const scene = ctx.view.scene;
    const t0 = performance.now();

    scene.add(landMesh(spec.land, spec.bounds));

    const heightAt = (x: number, y: number): number => terrain.heightAt(x, y);
    const layers: GroundLayer[] = [];

    // Far ground: the whole isthmus outside the detailed rect below, on the far height grid, coloured by land cover.
    ctx.services.provide(LandCoverKey, cover);
    const bk = terrain.grid;
    const bakedRect = { minX: bk.x0, minY: bk.y0, maxX: bk.x0 + (bk.cols - 1) * bk.cell, maxY: bk.y0 + (bk.rows - 1) * bk.cell };
    const { width: W, height: H } = spec.bounds;
    const strips = [
      { minX: 0, minY: 0, maxX: bakedRect.minX, maxY: H }, // west
      { minX: bakedRect.maxX, minY: 0, maxX: W, maxY: H }, // east
      { minX: bakedRect.minX, minY: 0, maxX: bakedRect.maxX, maxY: bakedRect.minY }, // south
      { minX: bakedRect.minX, minY: bakedRect.maxY, maxX: bakedRect.maxX, maxY: H }, // north
    ].filter((r) => r.maxX > r.minX && r.maxY > r.minY);
    const farPolys = strips.flatMap((r) => clipLandToRect(spec.land, r));
    const farSoup = drapeSoup(triangulatePolygons(farPolys), heightAt, FAR_DRAPE);
    const coverColor = (x: number, y: number): number => {
      const base = PALETTE.cover[coverAt(cover, x, y)] ?? PALETTE.land;
      // Denser jungle reads darker: shade by forest density (0.85 .. 1.15) so the canopy is not one flat tone.
      const k = 0.85 + 0.3 * (1 - densityAt(cover, x, y));
      const ch = (shift: number): number => Math.min(255, Math.round(((base >> shift) & 255) * k));
      return (ch(16) << 16) | (ch(8) << 8) | ch(0);
    };
    const far = farGroundMesh(farSoup, { heightAt, normalAt: (x, y) => terrain.normalAt(x, y) }, coverColor);
    addGround(scene, far);

    // Layer 3 water, whole isthmus: rivers follow their bed, Gatún Lake / canal reaches / lock chambers are flat at their levels,
    // lock aprons are grey slabs at the wall top, the chamber walls are grey blockout boxes. Rivers inside the detailed rect are
    // also drawn as a ground layer below (the city ground covers this mesh there), so streets stay on top where they cross.
    const waterSoup: HeightSoup = { positions: [], indices: [] };
    const addHeights = (s: HeightSoup): void => {
      const base = waterSoup.positions.length / 3;
      for (const v of s.positions) waterSoup.positions.push(v);
      for (const i of s.indices) waterSoup.indices.push(base + i);
    };
    for (const w of water.water) addHeights(liftSoup(triangulatePolygons([{ outer: w.ring, holes: w.holes }]), w.level + WATER_LIFT));
    for (const r of water.rivers) addHeights(riverSurface(r));
    scene.add(surfaceMesh(waterSoup, PALETTE.water, 'water', 'water'));
    const aprons: HeightSoup = { positions: [], indices: [] };
    for (const lock of water.locks) {
      const a = liftSoup(triangulatePolygons(lock.chambers.map((c) => ({ outer: c.apron, holes: [] }))), lock.apronTop + WATER_LIFT);
      const base = aprons.positions.length / 3;
      for (const v of a.positions) aprons.positions.push(v);
      for (const i of a.indices) aprons.indices.push(base + i);
    }
    scene.add(surfaceMesh(aprons, PALETTE.lockApron, 'apron', 'lock-aprons'));
    for (const lock of water.locks) scene.add(lockWallsMesh(lock.chambers, lock.apronTop, `lock-walls:${lock.id}`));

    // The land over the baked terrain (active rect + skirt), coloured by land cover like the far ground; city ground paints over it.
    const g = terrain.grid;
    const baked = { minX: g.x0, minY: g.y0, maxX: g.x0 + (g.cols - 1) * g.cell, maxY: g.y0 + (g.rows - 1) * g.cell };
    const landSoup = drapeSoup(triangulatePolygons(clipLandToRect(spec.land, baked)), heightAt, DRAPE.land);
    layers.push({ soup: landSoup, y: 0, color: PALETTE.land, colorAt: coverColor });

    // Rivers inside the baked rect: flat ribbons draped on the carved bed, under the street layers.
    const riverLayer: TriSoup = { positions: [], indices: [] };
    for (const r of water.rivers) {
      const rs = riverSurface(r, 0);
      for (let q = 0; q + 3 < rs.positions.length / 3; q += 2) {
        const inside = [q, q + 1, q + 2, q + 3].every((v) => {
          const x = rs.positions[v * 3] as number;
          const y = rs.positions[v * 3 + 1] as number;
          return x >= baked.minX && x <= baked.maxX && y >= baked.minY && y <= baked.maxY;
        });
        if (!inside) continue;
        const base = riverLayer.positions.length / 2;
        for (const v of [q, q + 1, q + 2, q + 3]) riverLayer.positions.push(rs.positions[v * 3] as number, rs.positions[v * 3 + 1] as number);
        riverLayer.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    layers.push({ soup: riverLayer, y: LAYER_Y.water, color: PALETTE.water });

    // Blocks: neutral ground; parks, court blocks and medians green.
    const groundColor = { park: PALETTE.park, median: PALETTE.median, court: PALETTE.park, commercial: PALETTE.blockGround, residential: PALETTE.blockGround };
    for (const color of new Set(Object.values(groundColor))) {
      const blocks = streets.blocks.filter((b) => isCityBlock(spec, b) && groundColor[city.landUse[b.id]?.use ?? 'residential'] === color);
      layers.push({ soup: triangulatePolygons(blocks.map((b) => ({ outer: b.ring, holes: b.holes }))), y: LAYER_Y.block, color });
    }
    // Court blocks: a court rectangle on the green (whole buildable part painted when none fits).
    const courtParts = city.landUse.filter((l) => l.use === 'court').flatMap((l) => city.buildable[l.block]?.parts ?? []);
    const courtFill: TriSoup = { positions: [], indices: [] };
    const lines: TriSoup = { positions: [], indices: [] };
    for (const part of courtParts) {
      const r = courtRect(part);
      if (r) {
        appendSoup(courtFill, triangulatePolygons([{ outer: r, holes: [] }]));
        appendSoup(lines, courtLines(r, COURT_LINE_M));
      } else {
        appendSoup(courtFill, triangulatePolygons([part]));
        appendSoup(lines, ringOutline(part.outer, COURT_LINE_M));
      }
    }
    layers.push({ soup: courtFill, y: LAYER_Y.court, color: PALETTE.court });
    layers.push({ soup: lines, y: LAYER_Y.courtLine, color: PALETTE.courtLine });

    // Routes that are not in the street graph (runways, rails, canals).
    for (const street of slice.streets) {
      if (AVENUE_KINDS.has(street.kind)) continue; // avenues are graph edges, drawn below
      const half = street.width / 2;
      const r = ribbon(street.centerline, half, half);
      layers.push({ soup: ribbonSoup(r.positions, r.indices), y: LAYER_Y.barrier, color: BARRIER_SURFACE[street.kind] ?? PALETTE.asphalt });
    }

    // Streets by class.
    const surf = buildStreetSurfaces(streets.graph);
    layers.push({ soup: surf.sidewalk, y: LAYER_Y.sidewalk, color: PALETTE.sidewalk });
    for (const cls of STREET_LAYERS) layers.push({ soup: surf.carriageway[cls], y: LAYER_Y[cls], color: PALETTE.street[cls] });
    layers.push({ soup: surf.centerSolid, y: LAYER_Y.marking, color: PALETTE.centerSolid });
    layers.push({ soup: surf.centerDashed, y: LAYER_Y.marking, color: PALETTE.centerDashed });

    const draped = layers.map((l, i) => (i === 0 ? l : { ...l, soup: drapeSoup(l.soup, heightAt, DRAPE.layers) }));
    const ground = groundMesh(draped, 'city-ground', {
      heightAt,
      normalAt: (x, y) => terrain.normalAt(x, y),
    });
    addGround(scene, ground);

    const tone = (b: CityBuilding): number =>
      city.landUse[b.block]?.use === 'commercial' ? PALETTE.buildingCommercial : PALETTE.buildingResidential;
    scene.add(buildingsMesh(buildings, tone, (b) => terrain.footprintBase(b)));
    const tris = (ground.geometry.index?.count ?? 0) / 3;
    console.log(`[world-view] ground triangles=${tris} buildings=${buildings.length} built in ${(performance.now() - t0).toFixed(0)} ms`);

    const labels: WorldLabel[] = [];
    for (const lm of slice.landmarks) {
      const h = terrain.heightAt(lm.position.x, lm.position.y);
      const p = specToScene(lm.position, h);
      const n = terrain.normalAt(lm.position.x, lm.position.y);
      const marker = landmarkMarker(lm.kind, { x: n.x, y: n.z, z: -n.y });
      marker.position.set(p.x, p.y, p.z);
      marker.name = `landmark:${lm.id}`;
      scene.add(marker);
      labels.push({ text: lm.displayName ?? lm.id, position: { x: p.x, y: p.y + MARKER_HEIGHT + 0.5, z: p.z } });
    }

    const worldLabels = createWorldLabels(ctx.ui, ctx.view.camera, labels);
    ctx.addSystem({ name: 'world-labels', phase: 'render', run: () => worldLabels.update() });
  },
};

function appendSoup(into: TriSoup, s: TriSoup): void {
  const base = into.positions.length / 2;
  for (const v of s.positions) into.positions.push(v);
  for (const i of s.indices) into.indices.push(base + i);
}
