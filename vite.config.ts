import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { isthmusBake } from './tools/vite-isthmus.ts';

// Map Studio (#13): the page validates a save through the protocol, then asks the dev server to write the
// edits file. Dev only; a production build has no endpoint and the page offers "Download edits" instead.
function studioSave(): Plugin {
  return {
    name: 'transito-studio-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__studio/save', (req, res) => {
        if (req.method !== 'POST') return void ((res.statusCode = 405), res.end('POST only'));
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            const o = JSON.parse(text) as { version?: number; edits?: unknown };
            if (o.version !== 1 || !Array.isArray(o.edits)) throw new Error('expected {"version":1,"edits":[…]}');
            const file = join(server.config.root, 'specs/map/procedural-edits.json');
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(`${file}.tmp`, text);
            renameSync(`${file}.tmp`, file);
            res.end('ok');
          } catch (e) {
            res.statusCode = 400;
            res.end(e instanceof Error ? e.message : String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [isthmusBake(), studioSave()],
});
