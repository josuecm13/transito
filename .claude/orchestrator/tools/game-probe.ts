// usage: node game-probe.ts <repo> -> game spec from the isthmus + streets/city on it (timings, counts)
import { readFileSync } from 'node:fs';
const repo = process.argv[2]!;
const t = () => performance.now();
const { parseWorldSpec } = await import(`${repo}/src/world/spec.ts`);
const { generateIsthmus } = await import(`${repo}/src/world/proc/isthmus.ts`);
const { gameSpecFromIsthmus } = await import(`${repo}/src/world/proc/game-spec.ts`);
const { sliceWorld } = await import(`${repo}/src/world/slice.ts`);
const { generateStreets, deriveCity } = await import(`${repo}/src/world/streets/index.ts`);
const spec = parseWorldSpec(readFileSync(`${repo}/specs/map/world.yaml`, 'utf8'));
let t0 = t(); const iso = generateIsthmus(spec); console.log('isthmus', (t() - t0).toFixed(0), 'ms');
t0 = t(); const g = gameSpecFromIsthmus(spec, iso); console.log('game spec', (t() - t0).toFixed(0), 'ms; rect', g.spec.activeArea.x, g.spec.activeArea.y, 'dropped', g.dropped);
const a = g.spec.activeArea; const cs = g.spec.bounds.cellSize; const rows = g.spec.grid.length; const counts = new Map();
for (let r = 0; r < rows; r++) for (let c = 0; c < g.spec.grid[0].length; c++) { const x = (c + 0.5) * cs, y = (rows - 1 - r + 0.5) * cs; if (x < a.x[0] || x > a.x[1] || y < a.y[0] || y > a.y[1]) continue; const k = g.spec.grid[r][c]; counts.set(k, (counts.get(k) ?? 0) + 1); }
console.log('district cells in rect', [...counts]);
t0 = t(); const slice = sliceWorld(g.spec); console.log('slice', (t() - t0).toFixed(0), 'ms; spawn', slice.spawn.id, slice.spawn.position, 'landmarks', slice.landmarks.map((l: any) => l.id), 'streets', slice.streets.map((s: any) => s.routeId));
t0 = t(); const net = generateStreets(g.spec, slice); console.log('streets', (t() - t0).toFixed(0), 'ms; edges', net.graph.edges.length);
t0 = t(); const city = deriveCity(g.spec, slice, net); console.log('city', (t() - t0).toFixed(0), 'ms; blocks', city.parcels.length, 'buildings', city.buildings.length, 'by district', [...city.buildings.reduce((m: Map<string, number>, b: any) => m.set(b.district, (m.get(b.district) ?? 0) + 1), new Map())]);
