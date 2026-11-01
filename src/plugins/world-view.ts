import type { GamePlugin } from '../ecs/plugin.ts';
import { WorldDataKey } from './keys.ts';
import { specToScene } from '../world/coords.ts';
import { ribbon } from '../world/ribbon.ts';
import { AVENUE_KINDS } from '../world/streets/region.ts';
import { buildStreetSurfaces, ringOutline, STREET_LAYERS } from '../world/street-surface.ts';
import type { TriSoup } from '../world/street-surface.ts';
import type { CityBuilding } from '../world/streets/buildings.ts';
import { courtLines, courtRect } from '../world/court-layout.ts';
import {
  MARKER_HEIGHT,
  PALETTE,
  buildingsMesh,
  groundMesh,
  landMesh,
  landmarkMarker,
  ribbonSoup,
  triangulatePolygons,
} from '../engine/meshes.ts';
import type { GroundLayer } from '../engine/meshes.ts';
import { createWorldLabels } from '../ui/world-labels.ts';
import type { WorldLabel } from '../ui/world-labels.ts';

/**
 * Ground layer heights (m above the land at y = 0), bottom-up. Higher layers paint over lower ones
 * where they overlap (junctions: the wider street class wins), so each overlapping pair needs its
 * own height. 1 cm steps are plenty of depth precision at the H0 camera distance.
 */
const LAYER_Y = {
  block: 0.01,
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

const BARRIER_SURFACE: Record<string, number> = {
  runway: PALETTE.runway,
  rail: PALETTE.rail,
  waterway: PALETTE.waterway,
};

export const worldView: GamePlugin = {
  name: 'world-view',
  dependsOn: ['world-data'],
  setup(ctx) {
    const { spec, slice, streets, city, buildings } = ctx.services.get(WorldDataKey);
    const scene = ctx.view.scene;
    const t0 = performance.now();

    scene.add(landMesh(spec.land, spec.bounds));

    const layers: GroundLayer[] = [];

    // Blocks: neutral ground; parks, court blocks and medians green.
    const groundColor = { park: PALETTE.park, median: PALETTE.median, court: PALETTE.park, commercial: PALETTE.blockGround, residential: PALETTE.blockGround };
    for (const color of new Set(Object.values(groundColor))) {
      const blocks = streets.blocks.filter((b) => groundColor[city.landUse[b.id]?.use ?? 'residential'] === color);
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

    const ground = groundMesh(layers, 'city-ground');
    scene.add(ground);

    const tone = (b: CityBuilding): number =>
      city.landUse[b.block]?.use === 'commercial' ? PALETTE.buildingCommercial : PALETTE.buildingResidential;
    scene.add(buildingsMesh(buildings, tone));
    const tris = (ground.geometry.index?.count ?? 0) / 3;
    console.log(`[world-view] ground triangles=${tris} buildings=${buildings.length} built in ${(performance.now() - t0).toFixed(0)} ms`);

    const labels: WorldLabel[] = [];
    for (const lm of slice.landmarks) {
      const p = specToScene(lm.position);
      const marker = landmarkMarker(lm.kind);
      marker.position.set(p.x, p.y, p.z);
      marker.name = `landmark:${lm.id}`;
      scene.add(marker);
      labels.push({ text: lm.displayName ?? lm.id, position: { x: p.x, y: MARKER_HEIGHT + 0.5, z: p.z } });
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
