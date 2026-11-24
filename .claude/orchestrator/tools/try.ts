// usage: node try.ts <repo> <out.png> 'sed-like replacements as JSON [[from,to],...]' -> report + L2 east midpoint
import { readFileSync, writeFileSync } from 'node:fs';
const [repo, out, reps] = process.argv.slice(2) as [string, string, string];
let yaml = readFileSync(`${repo}/specs/map/world.yaml`, 'utf8');
for (const [a, b] of JSON.parse(reps)) { if (!yaml.includes(a)) throw new Error('missing: ' + a); yaml = yaml.replace(a, b); }
const { parseWorldSpec } = await import(`${repo}/src/world/spec.ts`);
const { generateIsthmus, isthmusRenderInput } = await import(`${repo}/src/world/proc/isthmus.ts`);
const { renderMap } = await import(`${repo}/src/world/proc/render.ts`);
const { encodePng } = await import(`${repo}/src/world/proc/png.ts`);
const iso = generateIsthmus(parseWorldSpec(yaml));
for (const l of iso.report) console.log(l);
const t = iso.transit.lines.find((l: any) => l.id === 'linea-2').tracks[1];
let L = 0; for (let k = 1; k < t.length; k++) L += Math.hypot(t[k].x - t[k-1].x, t[k].y - t[k-1].y);
let acc = 0; for (let k = 1; k < t.length; k++) { const s = Math.hypot(t[k].x - t[k-1].x, t[k].y - t[k-1].y); if (acc + s >= L / 2) { const f = (L / 2 - acc) / s; console.log(`L2 east ${L.toFixed(0)} m, midpoint (${Math.round(t[k-1].x + f * (t[k].x - t[k-1].x))}, ${Math.round(t[k-1].y + f * (t[k].y - t[k-1].y))})`); break; } acc += s; }
const { distanceFrom, mask } = await import(`${repo}/src/world/proc/grid.ts`);
const g = iso.towns.density; const own = iso.towns.owner; const ids = ['la-ciudad','colon','balboa','el-corredor','gamboa'];
const dists = ids.map((_, k) => { const m = mask(g); for (let i = 0; i < own.length; i++) if (own[i] === k + 1) m.data[i] = 1; return distanceFrom(m); });
ids.forEach((id, k) => {
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1; const near: string[] = [];
  for (let i = 0; i < own.length; i++) if (own[i] === k + 1) { const x = (i % g.w) * g.cell, y = Math.floor(i / g.w) * g.cell; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  ids.forEach((_, l) => { if (l === k) return; let m = Infinity; for (let i = 0; i < own.length; i++) if (own[i] === l + 1) m = Math.min(m, dists[k].data[i]); if (m < 1e8) near.push(`${ids[l]} ${m.toFixed(0)}`); });
  console.log(`${id}: x ${x0}-${x1}, y ${y0}-${y1}; gap to ${near.join(', ')}`);
});
const ia = iso.roads.paths.find((r: any) => r.id === 'interamericana').cells;
console.log('interamericana', [0, .2, .4, .55, .7, .85, 1].map(f => { const c = ia[Math.min(ia.length - 1, Math.floor(f * ia.length))]; return `(${(c % g.w) * g.cell},${Math.floor(c / g.w) * g.cell})`; }).join(' '));
const l2 = iso.transit.lines.find((l: any) => l.id === 'linea-2').tracks[1];
console.log('L2 east', [0, .25, .5, .75, 1].map(f => { const q = l2[Math.min(l2.length - 1, Math.floor(f * l2.length))]; return `(${q.x.toFixed(0)},${q.y.toFixed(0)})`; }).join(' '));
const img = renderMap(isthmusRenderInput(iso), { metresPerPixel: 5, exaggeration: 2.2, seed: 5 });
writeFileSync(out, encodePng(img.width, img.height, img.rgb));
