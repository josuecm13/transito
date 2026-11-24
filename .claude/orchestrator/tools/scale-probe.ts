// usage: node scale-probe.ts <repo> -> stats of the buildings the game builds (buildWorldData), by method and distance to spawn
import { readFileSync } from 'node:fs';
const repo = process.argv[2]!;
const { buildWorldData } = await import(`${repo}/src/world/world-data.ts`);
const wd = buildWorldData(readFileSync(`${repo}/specs/map/world.yaml`, 'utf8'));
const sp = wd.slice.spawn.position;
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : NaN; };
console.log('spawn', sp, 'buildings', wd.buildings.length);
const groups = new Map<string, any[]>();
for (const b of wd.buildings) {
  const d = Math.hypot(b.center.x - sp.x, b.center.y - sp.y);
  const k = `${b.district} ${b.parcel === -1 ? 'frontage' : 'parcel'} ${d < 150 ? '<150m' : 'far'}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(b);
}
for (const [k, bs] of [...groups].sort()) {
  const w = bs.map((b) => b.width), dp = bs.map((b) => b.depth), h = bs.map((b) => b.height);
  console.log(k.padEnd(40), 'n', String(bs.length).padStart(4), ' width p10/50/90', q(w, .1), q(w, .5), q(w, .9), ' depth', q(dp, .1), q(dp, .5), q(dp, .9), ' height', q(h, .1), q(h, .5), q(h, .9));
}
// Visible wall height: the base sits at the LOWEST ground under the footprint (terrain.footprintBase),
// so the downhill face shows height + (highest − lowest ground under the footprint).
const drop = (b: any) => { const c = Math.cos(b.angle), s = Math.sin(b.angle); let lo = Infinity, hi = -Infinity;
  for (const u of [-0.5, 0, 0.5]) for (const v of [-0.5, 0, 0.5]) { const lx = u * b.width, ly = v * b.depth; const h = wd.terrain.heightAt(b.center.x + lx * c - ly * s, b.center.y + lx * s + ly * c); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  return hi - lo; };
for (const r of [150, 400]) {
  const near = wd.buildings.filter((b: any) => Math.hypot(b.center.x - sp.x, b.center.y - sp.y) < r);
  const dr = near.map(drop), vis = near.map((b: any, i: number) => b.height + dr[i]);
  console.log(`within ${r} m: n ${near.length}  ground drop under footprint p10/50/90 ${q(dr, .1)} ${q(dr, .5)} ${q(dr, .9)}  downhill wall p10/50/90 ${q(vis, .1)} ${q(vis, .5)} ${q(vis, .9)} max ${q(vis, 1)}`);
}
console.log('spawn ground', wd.terrain.heightAt(sp.x, sp.y).toFixed(1), 'slope probe ±20 m:', [[20,0],[-20,0],[0,20],[0,-20]].map(([dx,dy]) => (wd.terrain.heightAt(sp.x+dx, sp.y+dy) - wd.terrain.heightAt(sp.x, sp.y)).toFixed(1)).join(' '));
