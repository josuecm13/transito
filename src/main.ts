import { createGame } from './engine/game.ts';
import { worldData } from './plugins/world-data.ts';
import { worldView } from './plugins/world-view.ts';
import { worldPhysics } from './plugins/world-physics.ts';
import { player } from './plugins/player.ts';
import { vehicle } from './plugins/vehicle.ts';
import { landmarkTriggers } from './plugins/landmark-triggers.ts';
import { pedestrians } from './plugins/pedestrians.ts';
import { cameraFollow } from './plugins/camera-follow.ts';
import { minimap } from './plugins/minimap.ts';
import { screens } from './plugins/screens.ts';
import { pauseMenu } from './plugins/pause-menu.ts';
import { worldMap } from './plugins/world-map.ts';
import { debugHud } from './plugins/debug-hud.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

await createGame({
  canvas,
  ui,
  plugins: [worldData, worldView, worldPhysics, player, vehicle, landmarkTriggers, minimap, pedestrians, cameraFollow, screens, pauseMenu, worldMap, debugHud],
});
