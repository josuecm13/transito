// usage: node fp.ts <repo>  -> per-part sha256 of generateIsthmus(default spec)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const repo = process.argv[2]!;
const { parseWorldSpec } = await import(`${repo}/src/world/spec.ts`);
const { generateIsthmus } = await import(`${repo}/src/world/proc/isthmus.ts`);
const spec = parseWorldSpec(readFileSync(`${repo}/specs/map/world.yaml`, 'utf8'));
const iso = generateIsthmus(spec);
const h = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? Buffer.from((x as Uint8Array).buffer).toString('base64') : x))).digest('hex').slice(0, 16);
const parts: Record<string, unknown> = {
  relief: iso.relief.height.data, height: iso.height.data, lake: [iso.lake.lake.data, iso.lake.level, iso.lake.dam], rivers: iso.rivers,
  canal: [iso.canal.centreline, iso.canal.locks], airport: [iso.airport.centre, iso.airport.runways, iso.airport.field, iso.airport.terminal],
  roads: iso.roads.paths, townsOwner: iso.towns.owner, townsDensity: iso.towns.density.data, cover: iso.cover,
  transit: [iso.transit.lines, iso.transit.stations],
};
for (const [k, v] of Object.entries(parts)) console.log(k.padEnd(13), h(v));
for (const line of iso.report) console.log('  report:', line);
