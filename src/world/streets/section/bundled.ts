/**
 * Section profile files as text, for buildWorldData. The browser build bundles specs/map/sections/*.json
 * (Vite glob, as ?raw text); under Node (tests, tools) the same files are read from disk. Keys are repo-relative
 * paths, the same strings world.yaml `section_profiles:` holds.
 */
export function bundledSectionSources(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const mods = import.meta.glob('../../../../specs/map/sections/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    for (const [k, v] of Object.entries(mods)) out[k.slice(k.indexOf('specs/'))] = v;
    return out;
  } catch {
    // not running under Vite: read from disk below
  }
  const fs = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.('node:fs') as
    | { readdirSync(p: URL): string[]; readFileSync(p: URL, e: 'utf8'): string }
    | undefined;
  if (!fs) return out;
  const dir = new URL('../../../../specs/map/sections/', import.meta.url);
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) out[`specs/map/sections/${f}`] = fs.readFileSync(new URL(f, dir), 'utf8');
  return out;
}
