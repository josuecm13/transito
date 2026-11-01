// Dev harness: world + player + triggers, without touching main.ts.
import { createGame } from '../engine/game.ts';
import { worldData } from '../plugins/world-data.ts';
import { worldView } from '../plugins/world-view.ts';
import { worldPhysics } from '../plugins/world-physics.ts';
import { cameraFollow } from '../plugins/camera-follow.ts';
import { player } from '../plugins/player.ts';
import { landmarkTriggers } from '../plugins/landmark-triggers.ts';
import { minimap } from '../plugins/minimap.ts';
import { debugHud } from '../plugins/debug-hud.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

const game = await createGame({
  canvas,
  ui,
  plugins: [worldData, worldView, worldPhysics, cameraFollow, player, landmarkTriggers, minimap, debugHud],
});

// Handy for QA evals: window.__game.ctx.ecs
(window as unknown as { __game: typeof game }).__game = game;
