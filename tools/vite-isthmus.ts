// Vite plugin (#12 2.5, card F6): the procedural isthmus is baked at build time instead of generated
// on the main thread at startup (~6 s). `import { isthmusUrl } from 'virtual:isthmus'` gives the URL of
// the baked file (src/world/proc/isthmus-codec.ts format).
//
// The bake is keyed by a hash of specs/map/world.yaml and every src/world/**/*.ts (the generator only
// imports from src/world and npm packages): .cache/isthmus-<hash>.bin, made by tools/bake-isthmus.ts in
// a child process when missing. `vite build` emits it as assets/isthmus-<hash>.bin; the dev server
// serves it from .cache and rebakes when an input changes (the virtual module watches them).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { EDITS_FILE } from '../src/studio/saved.ts';

const ID = 'virtual:isthmus';
const RESOLVED = `\0${ID}`;

// The bake's inputs: world.yaml, the saved studio edits when present, and every .ts under src/world (tests/proc-isthmus-codec.test.ts checks they cover the generator's imports).
export function inputFiles(root: string): string[] {
  const out = [join(root, 'specs/map/world.yaml')];
  // Map Studio's saved edits (#13) are applied on top of world.yaml by the bake: a Save must rebake.
  if (existsSync(join(root, EDITS_FILE))) out.push(join(root, EDITS_FILE));
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(p);
    }
  };
  walk(join(root, 'src/world'));
  return out.sort();
}

function ensureBaked(root: string): { file: string; hash: string; inputs: string[] } {
  const inputs = inputFiles(root);
  const h = createHash('sha256');
  for (const f of inputs) h.update(relative(root, f)).update('\0').update(readFileSync(f)).update('\0');
  const hash = h.digest('hex').slice(0, 16);
  const cache = join(root, '.cache');
  const file = join(cache, `isthmus-${hash}.bin`);
  if (!existsSync(file)) {
    const r = spawnSync(process.execPath, ['--max-old-space-size=1536', join(root, 'tools/bake-isthmus.ts'), file], { stdio: 'inherit' });
    if (r.status !== 0 || !existsSync(file)) throw new Error(`bake-isthmus failed (exit ${r.status})`);
    // Older bakes are stale by construction.
    for (const f of readdirSync(cache)) if (/^isthmus-[0-9a-f]+\.bin$/.test(f) && join(cache, f) !== file) rmSync(join(cache, f));
  }
  return { file, hash, inputs };
}

export function isthmusBake(): Plugin {
  let root = process.cwd();
  let command: 'serve' | 'build' = 'serve';
  return {
    name: 'transito-isthmus',
    configResolved(c) {
      root = c.root;
      command = c.command;
    },
    resolveId(id) {
      return id === ID ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      const baked = ensureBaked(root);
      for (const f of baked.inputs) this.addWatchFile(f);
      const fileName = `assets/isthmus-${baked.hash}.bin`;
      if (command === 'build') this.emitFile({ type: 'asset', fileName, source: readFileSync(baked.file) });
      return `export const isthmusUrl = import.meta.env.BASE_URL + ${JSON.stringify(fileName)};`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/assets\/isthmus-([0-9a-f]{16})\.bin(?:\?.*)?$/.exec(req.url ?? '');
        if (!m) return next();
        const file = join(root, '.cache', `isthmus-${m[1]}.bin`);
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(readFileSync(file));
      });
    },
  };
}
