import type { GamePlugin } from '../ecs/plugin.ts';
import { WorldDataKey } from './keys.ts';
import { specToScene } from '../world/coords.ts';
import { offsetPolyline } from '../world/geometry.ts';
import { ribbon } from '../world/ribbon.ts';
import {
  MARKER_HEIGHT,
  PALETTE,
  buildingsMesh,
  landMesh,
  landmarkMarker,
  ribbonMesh,
} from '../engine/meshes.ts';
import { createWorldLabels } from '../ui/world-labels.ts';
import type { WorldLabel } from '../ui/world-labels.ts';

const Y = { carriageway: 0.03, sidewalk: 0.05 };

const SURFACE: Record<string, number> = {
  runway: PALETTE.runway,
  rail: PALETTE.rail,
  waterway: PALETTE.waterway,
};

export const worldView: GamePlugin = {
  name: 'world-view',
  dependsOn: ['world-data'],
  setup(ctx) {
    const { spec, slice, buildings } = ctx.services.get(WorldDataKey);
    const scene = ctx.view.scene;

    scene.add(landMesh(spec.land, spec.bounds));

    for (const street of slice.streets) {
      const half = street.width / 2;
      const r = ribbon(street.centerline, half, half);
      scene.add(ribbonMesh(r.positions, r.indices, Y.carriageway, SURFACE[street.kind] ?? PALETTE.asphalt));
      if (street.sidewalk > 0) {
        const mid = half + street.sidewalk / 2;
        for (const side of [1, -1]) {
          const line = offsetPolyline(street.centerline, side * mid);
          const sw = ribbon(line, street.sidewalk / 2, street.sidewalk / 2);
          scene.add(ribbonMesh(sw.positions, sw.indices, Y.sidewalk, PALETTE.sidewalk));
        }
      }
    }

    scene.add(buildingsMesh(buildings));

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
