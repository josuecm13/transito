// usage: node home-probe.ts <repo> -> distance from tito-home to every street edge of the game's world, by class/district
import { readFileSync } from 'node:fs';
const repo = process.argv[2]!;
const { buildWorldData } = await import(`${repo}/src/world/world-data.ts`);
const { decodeIsthmus } = await import(`${repo}/src/world/proc/isthmus-codec.ts`);
const file = readFileSync(`${repo}/.cache/${process.argv[3]}`);
const iso = decodeIsthmus(new Uint8Array(file));
const wd = buildWorldData(readFileSync(`${repo}/specs/map/world.yaml`, 'utf8'), iso);
const home = wd.slice.landmarks.find((l: any) => l.id === 'tito-home') ?? wd.slice.spawn;
const p = home.position;
console.log('tito-home', p, 'spawn', wd.slice.spawn.id, wd.slice.spawn.position);
const g = wd.streets.graph;
const segDist = (a: any, b: any) => { const dx = b.x - a.x, dy = b.y - a.y; const L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0; return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); };
const byId = new Map(g.nodes.map((n: any) => [n.id, n])); const N = (id: number) => byId.get(id);
const rows: any[] = [];
for (const e of g.edges) {
  const pts = [N(e.a), N(e.b)];
  let d = Infinity; for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(pts[i], pts[i + 1]));
  rows.push({ d, cls: e.cls, district: e.district, routeId: e.routeId, width: e.width, sidewalk: e.sidewalk });
}
rows.sort((a, b) => a.d - b.d);
for (const r of rows.slice(0, 8)) console.log(r.d.toFixed(1).padStart(7), r.cls, r.district ?? '-', r.routeId ?? '-', 'half-width+sidewalk', (r.width / 2 + r.sidewalk).toFixed(1));
const gen = rows.filter((r) => r.district && !r.routeId);
console.log('nearest generated street:', gen[0] ? gen[0].d.toFixed(1) + ' m' : 'none', ' nearest avenue:', rows.find((r) => r.routeId)?.d.toFixed(1));
