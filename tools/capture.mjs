#!/usr/bin/env node
// Real-time screenshot + console capture via Chrome DevTools Protocol. Zero dependencies (Node 22).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
}
if (!args.out) {
  console.error('usage: capture.mjs --out <png> [--url u] [--wait ms] [--size WxH] [--keys "KeyW:1500,..."] [--eval "js"]');
  process.exit(2);
}
const url = args.url ?? 'http://localhost:5173/';
const waitMs = Number(args.wait ?? 4000);
const [W, H] = (args.size ?? '1280x720').split('x').map(Number);
const keys = (args.keys ?? '')
  .split(',')
  .filter(Boolean)
  .map((s) => {
    const [code, ms] = s.split(':');
    return { code, ms: Number(ms ?? 100) };
  });
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on('error', rej);
  });

const profile = mkdtempSync(join(tmpdir(), 'transito-chrome-'));
let chrome;
let failed = false;
let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { chrome?.kill('SIGKILL'); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

// Key metadata for KeyboardEvent.code
function keyInfo(code) {
  let key = code, vk = 0, text;
  if (/^Key[A-Z]$/.test(code)) { key = code[3].toLowerCase(); vk = code.charCodeAt(3); text = key; }
  else if (/^Digit\d$/.test(code)) { key = code[5]; vk = code.charCodeAt(5); text = key; }
  else if (code === 'Space') { key = ' '; vk = 32; text = ' '; }
  else if (code === 'ShiftLeft' || code === 'ShiftRight') { key = 'Shift'; vk = 16; }
  else if (code === 'Enter') { key = 'Enter'; vk = 13; text = '\r'; }
  else if (code === 'ArrowUp') { key = code; vk = 38; }
  else if (code === 'ArrowDown') { key = code; vk = 40; }
  else if (code === 'ArrowLeft') { key = code; vk = 37; }
  else if (code === 'ArrowRight') { key = code; vk = 39; }
  return { key, vk, text };
}

async function main() {
  const port = await freePort();
  chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  chrome.on('error', (e) => { console.error('[capture] chrome spawn failed:', e.message); failed = true; cleanup(); process.exit(1); });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
    try { if ((await fetch(`${base}/json/version`)).ok) { ready = true; break; } } catch {}
    await sleep(200);
  }
  if (!ready) throw new Error('Chrome did not become ready in 15 s');

  const targets = await (await fetch(`${base}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket error')); });

  let nextId = 1;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      return;
    }
    switch (msg.method) {
      case 'Runtime.consoleAPICalled': {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
        console.log(`[console.${msg.params.type}] ${text}`);
        break;
      }
      case 'Runtime.exceptionThrown': {
        const d = msg.params.exceptionDetails;
        console.log(`[pageerror] ${d.exception?.description ?? d.text}`);
        failed = true;
        break;
      }
      case 'Log.entryAdded': {
        const e = msg.params.entry;
        if (e.level === 'error') console.log(`[log.error] ${e.text} ${e.url ?? ''}`);
        break;
      }
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].method === msg.method) { waiters[i].res(msg.params); waiters.splice(i, 1); }
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const waitEvent = (method, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), ms);
    waiters.push({ method, res: (p) => { clearTimeout(t); res(p); } });
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  const loaded = waitEvent('Page.loadEventFired', 30000);
  const nav = await send('Page.navigate', { url });
  if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
  await loaded;
  await sleep(waitMs);

  for (const { code, ms } of keys) {
    const { key, vk, text } = keyInfo(code);
    const base = { code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) });
    await sleep(ms);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  if (keys.length) await sleep(500);

  if (args.eval) {
    const r = await send('Runtime.evaluate', { expression: args.eval, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      console.log(`[eval] ERROR ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      failed = true;
    } else {
      console.log(`[eval] ${JSON.stringify(r.result.value)}`);
    }
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`[capture] wrote ${out}`);
  ws.close();
}

try {
  await main();
} catch (e) {
  console.error(`[capture] ${e.message}`);
  failed = true;
}
cleanup();
process.exit(failed ? 1 : 0);
