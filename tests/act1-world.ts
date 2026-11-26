// The Act 1 build exactly as the game makes it (buildWorldData): the isthmus-derived spec (district_cell grid),
// the saved Studio edits, and the section profiles. Shared by the street / city tests that need the real El Corredor.
import { readFileSync } from 'node:fs';
import { parseWorldWithEdits } from '../src/studio/saved.ts';
import { generateIsthmus } from '../src/world/proc/isthmus.ts';
import { buildWorldData, type WorldData } from '../src/world/world-data.ts';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

let memo: WorldData | undefined;
/** Same build the game and tests/section-generate.test.ts use; computed once per test process. */
export function act1World(): WorldData {
  if (!memo) {
    const yaml = read('specs/map/world.yaml');
    memo = buildWorldData(yaml, generateIsthmus(parseWorldWithEdits(yaml, read('specs/map/procedural-edits.json'))));
  }
  return memo;
}
