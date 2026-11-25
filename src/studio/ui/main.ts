/**
 * Map Studio page (#13 card 7). All terrain, validation and guard logic is `handle` in src/studio/protocol.ts,
 * run in a worker (./worker.ts); this file only turns inputs into protocol requests and draws the answers.
 * A refused edit shows the guard's own message and leaves the last valid map in place.
 */
import { load } from 'js-yaml';
import worldYaml from '../../../specs/map/world.yaml?raw';
import { getAt, type Json } from '../paths.ts';
import type { Request } from '../protocol.ts';
import { serialiseEdits } from '../saved.ts';
import type { Edits } from '../session.ts';
import type { FromWorker, JobKind, ToWorker } from './messages.ts';

const savedFiles = import.meta.glob('../../../specs/map/procedural-edits.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const savedJson = Object.values(savedFiles)[0];

const COARSE = 40;
const FINE = 20;
const doc = load(worldYaml) as { bounds: { width: number; height: number }; procedural: Json };
const MAP_W = doc.bounds.width;
const MAP_H = doc.bounds.height;
const baseProc = doc.procedural;

interface ParamEntry { path: string; type: string; default: Json; doc?: { min?: number; max?: number; unit?: string; integer?: boolean; desc: string } }
interface Preset { id: string; style: string; sigma: number; weight: number; anchor: 'at' | 'along' | 'around'; describe: string }
type Done = Extract<FromWorker, { type: 'done' }>;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ---------------------------------------------------------------- worker plumbing
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const post = (m: ToWorker): void => worker.postMessage(m);
let nextId = 1;
let gen = 0;
const pending = new Map<number, { kind: JobKind; gen: number; then?: (m: Done) => void }>();

function send(kind: JobKind, req: Request, opts: { edits?: Edits; then?: (m: Done) => void } = {}): void {
  const id = nextId++;
  pending.set(id, { kind, gen, then: opts.then });
  post({ type: 'job', id, gen, kind, req, edits: opts.edits });
}

// ---------------------------------------------------------------- state
let accepted: Edits = [];
let undo: Edits[] = [];
let redo: Edits[] = [];
let config: Json = baseProc;
let params: ParamEntry[] = [];
let presets: Preset[] = [];
let metrics: Record<string, unknown> | undefined;
let violations: { guard: string; message: string }[] = [];
let genLabel = 'starting…';

interface Shot { canvas: HTMLCanvasElement; tier: number }
let current: Shot | undefined;
let before: Shot | undefined;
const layers: Record<string, boolean> = { image: true, ridges: false, districts: true, towns: true, roadStops: true, routes: true, transitStops: true, hints: true, canal: true, labels: false, grid: false };
const layerNames: Record<string, string> = { image: 'Map', ridges: 'Ridge zones', districts: 'Districts', towns: 'Town seeds', roadStops: 'Road stops', routes: 'Road routes', transitStops: 'Metro stops', hints: 'Airport / dam hints', canal: 'Canal anchors (pinned)', labels: 'Labels', grid: 'Grid (1 km)' };
let allowPinned = false;

const toCanvas = (img: { width: number; height: number; rgb: Uint8Array }): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const d = new ImageData(img.width, img.height);
  for (let i = 0, j = 0; i < img.rgb.length; i += 3, j += 4) {
    d.data[j] = img.rgb[i]!;
    d.data[j + 1] = img.rgb[i + 1]!;
    d.data[j + 2] = img.rgb[i + 2]!;
    d.data[j + 3] = 255;
  }
  c.getContext('2d')!.putImageData(d, 0, 0);
  return c;
};

// ---------------------------------------------------------------- messages
let msgTimer: number | undefined;
function showMsg(text: string, kind: 'bad' | 'ok', ms = 9000): void {
  const m = $('msg');
  m.textContent = text;
  m.className = kind;
  clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => (m.className = ''), ms);
}
function setStatus(): void {
  const v = violations.length ? `<span class="bad">${violations.length} guard violation(s)</span>` : '<span class="ok">guards ok</span>';
  $('st-gen').innerHTML = `${genLabel} · ${v}`;
  $('st-edits').textContent = `${accepted.length} edit(s) · undo ${undo.length} · redo ${redo.length}`;
  ($('undo') as HTMLButtonElement).disabled = !undo.length;
  ($('redo') as HTMLButtonElement).disabled = !redo.length;
}

// ---------------------------------------------------------------- edit pipeline
function refreshAfterAccept(m: Done, label: string): void {
  accepted = m.working;
  const r = m.outcome.response;
  if (r.metrics) metrics = r.metrics as unknown as Record<string, unknown>;
  violations = r.violations ?? [];
  genLabel = label;
  send('query', { op: 'export' }, { then: (e) => { config = (e.outcome.response.data as { config: Json }).config; renderInspector(true); draw(); } });
  requestPreviews();
  setStatus();
}

function requestPreviews(): void {
  const g = gen;
  genLabel = `coarse ${COARSE} m…`;
  send('preview', { op: 'preview', cell: COARSE, metresPerPixel: 15 }, { then: (m) => onPreview(m, g) });
  send('preview', { op: 'preview', cell: FINE, metresPerPixel: 10 }, { then: (m) => onPreview(m, g) });
}

function onPreview(m: Done, g: number): void {
  if (g < gen) return; // an edit happened after this generation was requested
  const r = m.outcome.response;
  // The validated cell is the truth: an edit that passed the coarse check but is unbuildable or breaks a
  // guard at 20 m is refused after the fact, rolled back, and the reason shown.
  const rollback = (why: string): void => {
    if (!undo.length) return;
    showMsg(`Refused at ${FINE} m: ${why}\nThe edit was rolled back.`, 'bad', 15000);
    restore(undo[undo.length - 1]!, undo, redo, true);
  };
  if (!m.outcome.image) {
    genLabel = `preview failed: ${r.errors.join('; ')}`;
    if (m.cell === FINE) rollback(r.errors.join('; '));
    else showMsg(`Preview failed at ${m.cell} m: ${r.errors.join('\n')}`, 'bad');
    return setStatus();
  }
  current = { canvas: toCanvas(m.outcome.image), tier: m.cell };
  if (m.cell === COARSE && !accepted.length && !before) before = current;
  if (m.cell === FINE && !accepted.length) before = current;
  if (r.metrics) metrics = r.metrics as unknown as Record<string, unknown>;
  violations = r.violations ?? [];
  genLabel = m.cell === FINE ? `validated at ${FINE} m (${(m.ms / 1000).toFixed(1)} s)` : `coarse ${COARSE} m (${(m.ms / 1000).toFixed(1)} s); validating at ${FINE} m…`;
  if (m.cell === FINE && violations.length) rollback(violations.map((v) => `${v.guard}: ${v.message}`).join('\n'));
  renderMetrics();
  setStatus();
  draw();
}

function commit(req: Request): void {
  gen++;
  genLabel = 'applying edit…';
  setStatus();
  send('edit', { ...req, cell: COARSE } as Request, {
    then: (m) => {
      const r = m.outcome.response;
      if (!r.ok) {
        // The guard's own words; the last valid map stays and the inputs snap back to it.
        showMsg(`Refused: ${r.errors.join('\n')}`, 'bad', 14000);
        genLabel = 'edit refused; last valid map kept';
        renderInspector(true);
        setStatus();
        return;
      }
      undo.push(accepted);
      redo = [];
      refreshAfterAccept(m, 'edit accepted');
      if (r.changed?.length === 0 && req.op !== 'reset') showMsg('No change: that is the authored value.', 'ok', 3000);
    },
  });
}

function restore(list: Edits, from: Edits[], to: Edits[], discard = false): void {
  gen++;
  const prev = accepted;
  send('restore', { op: 'patch', changes: [], cell: COARSE }, {
    edits: list,
    then: (m) => {
      if (!m.outcome.response.ok) return showMsg(`Cannot restore: ${m.outcome.response.errors.join('\n')}`, 'bad');
      from.pop();
      if (!discard) to.push(prev);
      refreshAfterAccept(m, discard ? 'rolled back' : 'restored');
    },
  });
}

let pend = new Map<string, Json>();
let flushTimer: number | undefined;
function change(path: string, value: Json, now = false): void {
  pend.set(path, value);
  clearTimeout(flushTimer);
  const flush = (): void => {
    const changes = [...pend].map(([p, v]) => ({ path: p, value: v }));
    pend = new Map();
    commit({ op: 'patch', changes });
  };
  if (now) flush();
  else flushTimer = window.setTimeout(flush, 350);
}

// ---------------------------------------------------------------- anchors
interface Anchor { name: string; label: string; pos: [number, number]; hard: boolean }
function anchors(): Anchor[] {
  const out: Anchor[] = [];
  const pt = (v: Json | undefined): [number, number] | undefined => (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : undefined);
  const stops = (kind: 'roads' | 'transit', on: string) => {
    if (!layers[on]) return;
    for (const [id, v] of Object.entries((getAt(config, `${kind}.stops`) ?? {}) as Record<string, Json>)) {
      const p = pt(v);
      if (p) out.push({ name: `stop:${kind}:${id}`, label: id, pos: p, hard: false });
    }
  };
  stops('roads', 'roadStops');
  stops('transit', 'transitStops');
  if (layers.hints) {
    const a = pt(getAt(config, 'airport.hint'));
    const d = pt(getAt(config, 'lake.dam_hint'));
    if (a) out.push({ name: 'hint:airport', label: 'airport hint', pos: a, hard: false });
    if (d) out.push({ name: 'hint:dam', label: 'dam hint', pos: d, hard: false });
  }
  if (layers.canal)
    for (const k of ['caribbean', 'pacific_locks', 'pacific']) {
      const p = pt(getAt(config, `canal.${k}`));
      if (p) out.push({ name: `canal:${k}`, label: `canal ${k}`, pos: p, hard: true });
    }
  if (layers.towns)
    for (const t of (getAt(config, 'towns.items') ?? []) as { id: string; seeds?: Json[] }[])
      (t.seeds ?? []).forEach((s, i) => { const p = pt(s); if (p) out.push({ name: `seed:${t.id}:${i}`, label: `${t.id} #${i}`, pos: p, hard: false }); });
  if (layers.districts)
    for (const d of (getAt(config, 'districts.items') ?? []) as { id: string; at?: Json }[]) {
      const p = pt(d.at);
      if (p) out.push({ name: `district:${d.id}`, label: d.id, pos: p, hard: false });
    }
  return out;
}

function moveAnchor(a: Anchor, to: [number, number]): void {
  if (a.hard && !allowPinned) {
    showMsg(`${a.label} is a pinned anchor of the approved map. Tick "Allow moving pinned anchors" in Connections to move it.`, 'bad');
    return renderInspector(true);
  }
  const x = Math.round(to[0]);
  const y = Math.round(to[1]);
  if (a.hard) showMsg(`Moving pinned anchor ${a.label} to (${x}, ${y}) because you allowed it.`, 'ok', 5000);
  commit({ op: 'move-anchor', anchor: a.name, to: [x, y], ...(a.hard ? { force: true } : {}) });
}

// ---------------------------------------------------------------- canvas
const cv = $('cv') as HTMLCanvasElement;
const g2 = cv.getContext('2d')!;
const view = { x: MAP_W / 2, y: MAP_H / 2, k: 0.1 };
let splitPos = 0.5;
let drag: { kind: 'pan'; sx: number; sy: number; vx: number; vy: number } | { kind: 'anchor'; a: Anchor; pos: [number, number] } | undefined;

const sx = (x: number): number => (x - view.x) * view.k + cv.clientWidth / 2;
const sy = (y: number): number => cv.clientHeight / 2 - (y - view.y) * view.k;
const mx = (px: number): number => (px - cv.clientWidth / 2) / view.k + view.x;
const my = (py: number): number => (cv.clientHeight / 2 - py) / view.k + view.y;

function fit(): void {
  view.k = Math.min(cv.clientWidth / MAP_W, cv.clientHeight / MAP_H) * 0.96;
  view.x = MAP_W / 2;
  view.y = MAP_H / 2;
  draw();
}

function drawImage(shot: Shot, clip?: { x0: number; x1: number }): void {
  g2.save();
  if (clip) { g2.beginPath(); g2.rect(clip.x0, 0, clip.x1 - clip.x0, cv.clientHeight); g2.clip(); }
  g2.imageSmoothingEnabled = view.k * (MAP_W / shot.canvas.width) < 1;
  g2.drawImage(shot.canvas, sx(0), sy(MAP_H), MAP_W * view.k, MAP_H * view.k);
  g2.restore();
}

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(cv.clientWidth * dpr) || cv.height !== Math.round(cv.clientHeight * dpr)) {
    cv.width = Math.round(cv.clientWidth * dpr);
    cv.height = Math.round(cv.clientHeight * dpr);
  }
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);
  g2.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
  g2.fillStyle = '#0c0f12';
  g2.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
  const compare = ($('compare') as HTMLInputElement).checked && before && current;
  if (layers.image && current) {
    if (compare) {
      const cut = sx(0) + MAP_W * view.k * splitPos;
      drawImage(before!, { x0: -1e5, x1: cut });
      drawImage(current, { x0: cut, x1: 1e5 });
      g2.strokeStyle = '#fff';
      g2.lineWidth = 2;
      g2.beginPath(); g2.moveTo(cut, sy(MAP_H)); g2.lineTo(cut, sy(0)); g2.stroke();
    } else drawImage(current);
  } else {
    g2.strokeStyle = '#2d363e';
    g2.strokeRect(sx(0), sy(MAP_H), MAP_W * view.k, MAP_H * view.k);
  }
  if (layers.grid) {
    g2.strokeStyle = 'rgba(255,255,255,.12)';
    g2.lineWidth = 1;
    g2.beginPath();
    for (let x = 0; x <= MAP_W; x += 1000) { g2.moveTo(sx(x), sy(0)); g2.lineTo(sx(x), sy(MAP_H)); }
    for (let y = 0; y <= MAP_H; y += 1000) { g2.moveTo(sx(0), sy(y)); g2.lineTo(sx(MAP_W), sy(y)); }
    g2.stroke();
  }
  const pt = (v: Json | undefined): [number, number] | undefined => (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : undefined);
  if (layers.ridges)
    for (const z of (getAt(config, 'relief.zones') ?? []) as { id: string; kind: string; points?: Json[]; at?: Json; width?: number; radius?: number }[]) {
      g2.strokeStyle = 'rgba(220,170,90,.55)';
      g2.fillStyle = 'rgba(220,170,90,.12)';
      if (z.kind === 'line' && z.points) {
        g2.lineWidth = Math.max(1.5, (z.width ?? 0) * view.k);
        g2.globalAlpha = 0.25;
        g2.beginPath();
        z.points.forEach((p, i) => { const q = pt(p)!; i ? g2.lineTo(sx(q[0]), sy(q[1])) : g2.moveTo(sx(q[0]), sy(q[1])); });
        g2.stroke();
        g2.globalAlpha = 1;
      } else if (z.at) {
        const q = pt(z.at)!;
        g2.lineWidth = 1.5;
        g2.beginPath(); g2.arc(sx(q[0]), sy(q[1]), (z.radius ?? 0) * view.k, 0, 7); g2.fill(); g2.stroke();
      }
    }
  if (layers.districts)
    for (const d of (getAt(config, 'districts.items') ?? []) as { id: string; at?: Json; sigma: number; weight: number }[]) {
      const q = pt(d.at);
      if (!q) continue;
      g2.strokeStyle = d.weight < 0 ? 'rgba(224,96,90,.9)' : 'rgba(120,190,255,.9)';
      g2.fillStyle = d.weight < 0 ? 'rgba(224,96,90,.15)' : 'rgba(120,190,255,.15)';
      g2.lineWidth = 1.5;
      g2.beginPath(); g2.arc(sx(q[0]), sy(q[1]), d.sigma * view.k, 0, 7); g2.fill(); g2.stroke();
    }
  if (layers.routes) {
    const stops = (getAt(config, 'roads.stops') ?? {}) as Record<string, Json>;
    g2.setLineDash([6, 5]);
    g2.lineWidth = 1.5;
    for (const r of (getAt(config, 'roads.routes') ?? []) as { id: string; kind: string; stops: string[] }[]) {
      g2.strokeStyle = r.kind === 'rail' ? '#b9a98a' : '#e8c46a';
      g2.beginPath();
      r.stops.forEach((s, i) => { const q = pt(stops[s]); if (!q) return; i ? g2.lineTo(sx(q[0]), sy(q[1])) : g2.moveTo(sx(q[0]), sy(q[1])); });
      g2.stroke();
    }
    g2.setLineDash([]);
  }
  for (const a of anchors()) {
    const p = drag?.kind === 'anchor' && drag.a.name === a.name ? drag.pos : a.pos;
    const X = sx(p[0]);
    const Y = sy(p[1]);
    g2.fillStyle = a.hard ? '#ff6a6a' : a.name.startsWith('district') ? '#78beff' : a.name.startsWith('seed') ? '#9be06c' : a.name.startsWith('hint') ? '#fff' : '#ffd34a';
    g2.strokeStyle = '#000';
    g2.lineWidth = 1.5;
    g2.beginPath();
    if (a.hard) g2.rect(X - 6, Y - 6, 12, 12);
    else g2.arc(X, Y, 5.5, 0, 7);
    g2.fill(); g2.stroke();
    if (layers.labels || a.hard) { g2.fillStyle = '#fff'; g2.font = '11px system-ui'; g2.fillText(a.label + (a.hard ? ' 🔒' : ''), X + 9, Y - 7); }
  }
}

const hit = (px: number, py: number): Anchor | undefined => {
  let best: Anchor | undefined;
  let bd = 12;
  for (const a of anchors()) {
    const d = Math.hypot(sx(a.pos[0]) - px, sy(a.pos[1]) - py);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
};

cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  const a = hit(e.offsetX, e.offsetY);
  drag = a ? { kind: 'anchor', a, pos: [...a.pos] } : { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  cv.style.cursor = 'grabbing';
});
cv.addEventListener('pointermove', (e) => {
  $('st-pos').textContent = `x ${Math.round(mx(e.offsetX))}  y ${Math.round(my(e.offsetY))} m`;
  if (!drag) return void (cv.style.cursor = hit(e.offsetX, e.offsetY) ? 'pointer' : 'grab');
  if (drag.kind === 'pan') { view.x = drag.vx - (e.clientX - drag.sx) / view.k; view.y = drag.vy + (e.clientY - drag.sy) / view.k; }
  else drag.pos = [mx(e.offsetX), my(e.offsetY)];
  draw();
});
cv.addEventListener('pointerup', () => {
  const d = drag;
  drag = undefined;
  cv.style.cursor = 'grab';
  if (d?.kind === 'anchor' && Math.hypot(d.pos[0] - d.a.pos[0], d.pos[1] - d.a.pos[1]) > 5) moveAnchor(d.a, d.pos);
  draw();
});
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0015);
  const bx = mx(e.offsetX);
  const by = my(e.offsetY);
  view.k = Math.min(2, Math.max(0.03, view.k * f));
  view.x = bx - (e.offsetX - cv.clientWidth / 2) / view.k;
  view.y = by + (e.offsetY - cv.clientHeight / 2) / view.k;
  draw();
}, { passive: false });
window.addEventListener('resize', draw);

// ---------------------------------------------------------------- inspector
const GROUPS = [
  { id: 'world', title: 'World' },
  { id: 'land', title: 'Land & water' },
  { id: 'places', title: 'Places' },
  { id: 'conn', title: 'Connections' },
] as const;
const groupOf = (p: string): string => {
  if (/\.(relief\.(zones|coast|hummocks)|lake|rivers|canal)/.test(p)) return 'land';
  if (/\.relief\./.test(p)) return 'world';
  if (/\.(airport|towns|districts|landmarks|act1|suitability)\b/.test(p)) return 'places';
  if (/\.(roads|transit)\b/.test(p)) return 'conn';
  return 'world';
};
const inputs = new Map<string, () => void>();
const open = new Set<string>(['world', 'land', 'places', 'conn', 'result']);
const sections = new Map<string, HTMLElement>();

function section(id: string, title: string): HTMLElement {
  const s = el('section');
  if (!open.has(id)) s.className = 'closed';
  const h = el('h2', undefined, title);
  h.onclick = () => { s.classList.toggle('closed'); s.classList.contains('closed') ? open.delete(id) : open.add(id); };
  const b = el('div', 'body');
  s.append(h, b);
  sections.set(id, b);
  return s;
}
const valueOf = (path: string): Json | undefined => getAt(config, path.replace(/^procedural\./, ''));
const short = (path: string): string => path.replace(/^procedural\./, '').replace(/\.?\[id=([^\]]+)\]/g, ' › $1').replace(/\./g, ' › ');

function numberRow(parent: HTMLElement, p: ParamEntry): void {
  const d = p.doc;
  const row = el('div', 'row');
  row.append(el('span', 'name', short(p.path)));
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.dataset.path = p.path;
  if (d?.min !== undefined) inp.min = String(d.min);
  if (d?.max !== undefined) inp.max = String(d.max);
  inp.step = d?.integer ? '1' : String(Math.max((d?.max ?? 1) - (d?.min ?? 0), 0.01) / 200);
  inp.title = d ? `${d.desc}\nrange ${d.min ?? '-∞'} – ${d.max ?? '∞'}${d.unit ? ' ' + d.unit : ''}` : p.path;
  inp.oninput = () => { if (inp.value !== '') change(p.path, Number(inp.value)); };
  inp.onchange = () => { if (inp.value !== '') change(p.path, Number(inp.value), true); };
  row.append(inp);
  const u = el('span', 'u', d?.unit ?? '');
  if (/(^|\.)seed$/.test(p.path)) {
    const b = el('button', undefined, '🎲');
    b.title = 'Shuffle seed';
    b.onclick = () => change(p.path, Math.floor(Math.random() * (d?.max ?? 99999)), true);
    row.append(b);
  } else row.append(u);
  if (d) row.append(el('div', 'desc', d.desc + (d.min !== undefined ? `  [${d.min}–${d.max}]` : '')));
  parent.append(row);
  inputs.set(p.path, () => { if (document.activeElement !== inp) inp.value = String(valueOf(p.path) ?? ''); });
}

function pointRow(parent: HTMLElement, label: string, anchor: Anchor | undefined, path: string, hard = false): void {
  const row = el('div', hard ? 'row locked' : 'row');
  row.append(el('span', 'name', label));
  const wrap = el('span', 'pts');
  const ix = document.createElement('input');
  const iy = document.createElement('input');
  for (const i of [ix, iy]) { i.type = 'number'; i.className = 'pt'; i.step = '10'; }
  ix.dataset.path = iy.dataset.path = `pt:${path}`;
  ix.dataset.axis = 'x';
  iy.dataset.axis = 'y';
  wrap.append(ix, iy);
  row.append(wrap, el('span', 'u', 'm'));
  const go = (): void => {
    if (ix.value === '' || iy.value === '') return;
    const a: Anchor = anchor ?? { name: '', label, pos: [0, 0], hard };
    if (!anchor) return void change(path, [Number(ix.value), Number(iy.value)] as Json, true);
    moveAnchor(a, [Number(ix.value), Number(iy.value)]);
  };
  ix.onchange = go;
  iy.onchange = go;
  parent.append(row);
  inputs.set(`pt:${path}`, () => {
    const v = valueOf(path);
    if (Array.isArray(v) && document.activeElement !== ix && document.activeElement !== iy) { ix.value = String(v[0]); iy.value = String(v[1]); }
  });
}

function anchorPathOf(a: Anchor): string {
  const [k, x, y] = a.name.split(':');
  return k === 'stop' ? `procedural.${x}.stops.${y}` : k === 'district' ? `procedural.districts.items[id=${x}].at` : k === 'seed' ? `procedural.towns.items[id=${x}].seeds[${y}]` : k === 'canal' ? `procedural.canal.${x}` : x === 'airport' ? 'procedural.airport.hint' : 'procedural.lake.dam_hint';
}

function renderInspector(keepScroll = false): void {
  const side = $('side');
  const top = side.scrollTop;
  inputs.clear();
  sections.clear();
  side.replaceChildren();
  side.append(section('result', 'Result'));
  const res = sections.get('result')!;
  res.id = 'metrics';
  renderMetrics();
  for (const g of GROUPS) side.append(section(g.id, g.title));

  const W = sections.get('world')!;
  W.append(el('div', 'note', `Map extent: ${MAP_W} × ${MAP_H} m (locked). Changing it needs a rescale policy for the authored coast; that is an open question.`));
  const advanced = new Map<string, HTMLElement>();
  const adv = (g: string): HTMLElement => {
    let d = advanced.get(g);
    if (!d) {
      d = el('details');
      d.append(el('summary', 'sub', 'Other numeric parameters'));
      sections.get(g)!.append(d);
      advanced.set(g, d);
    }
    return d;
  };
  for (const p of params) {
    if (p.type !== 'number' || p.path === 'procedural.cell' || /\.(id)$/.test(p.path)) continue;
    const g = groupOf(p.path);
    if (/\.districts\.items\[/.test(p.path)) continue; // districts have their own list
    numberRow(p.doc ? sections.get(g)! : adv(g), p);
  }

  // Land & water: the pinned canal ends.
  const L = sections.get('land')!;
  L.append(el('div', 'sub', 'Canal anchors (pinned)'));
  for (const k of ['caribbean', 'pacific_locks', 'pacific']) pointRow(L, `canal ${k}`, { name: `canal:${k}`, label: `canal ${k}`, pos: [0, 0], hard: true }, `procedural.canal.${k}`, true);

  // Places: districts, presets, town seeds, hints.
  const P = sections.get('places')!;
  P.append(el('div', 'sub', 'Districts'));
  const items = (getAt(config, 'districts.items') ?? []) as { id: string; at?: Json; along?: string; around?: string; sigma: number; weight: number }[];
  if (!items.length) P.append(el('div', 'note', 'No districts placed. Add one from a preset below; nothing is added for you.'));
  for (const d of items) {
    P.append(el('div', 'name', `${d.id}${d.along ? ` (along ${d.along})` : d.around ? ' (around airport)' : ''}`));
    for (const k of ['sigma', 'weight'] as const) numberRow(P, { path: `procedural.districts.items[id=${d.id}].${k}`, type: 'number', default: d[k], doc: params.find((x) => x.path.endsWith(`items[*].${k}`))?.doc ?? findDoc(`procedural.districts.items[*].${k}`) });
    if (d.at) pointRow(P, 'at', { name: `district:${d.id}`, label: d.id, pos: [0, 0], hard: false }, `procedural.districts.items[id=${d.id}].at`);
    const rm = el('button', undefined, `Remove ${d.id}`);
    rm.onclick = () => commit({ op: 'remove-district', id: d.id });
    P.append(rm);
  }
  P.append(el('div', 'sub', 'Add a district'));
  const sel = document.createElement('select');
  for (const pr of presets) sel.append(new Option(`${pr.id} (${pr.style})`, pr.id));
  const ax = document.createElement('input'); ax.type = 'number'; ax.placeholder = 'x'; ax.className = 'pt';
  const ay = document.createElement('input'); ay.type = 'number'; ay.placeholder = 'y'; ay.className = 'pt';
  const route = document.createElement('select');
  for (const r of (getAt(config, 'roads.routes') ?? []) as { id: string }[]) route.append(new Option(r.id, r.id));
  const add = el('button', undefined, 'Add');
  const hint = el('div', 'desc');
  const upd = (): void => { const pr = presets.find((x) => x.id === sel.value)!; hint.textContent = pr.describe; ax.style.display = ay.style.display = pr.anchor === 'at' ? '' : 'none'; route.style.display = pr.anchor === 'along' ? '' : 'none'; };
  sel.onchange = upd;
  add.onclick = () => {
    const pr = presets.find((x) => x.id === sel.value)!;
    commit({ op: 'add-district', preset: pr.id, ...(pr.anchor === 'at' ? { at: [Number(ax.value), Number(ay.value)] as [number, number] } : pr.anchor === 'along' ? { along: route.value } : {}) });
  };
  const arow = el('div', 'pts');
  arow.append(sel, ax, ay, route, add);
  P.append(arow, hint);
  if (presets.length) upd();
  P.append(el('div', 'sub', 'Town seeds'));
  for (const t of (getAt(config, 'towns.items') ?? []) as { id: string; seeds?: Json[] }[])
    (t.seeds ?? []).forEach((_, i) => pointRow(P, `${t.id} seed ${i}`, { name: `seed:${t.id}:${i}`, label: `${t.id} #${i}`, pos: [0, 0], hard: false }, `procedural.towns.items[id=${t.id}].seeds[${i}]`));
  pointRow(P, 'airport hint', { name: 'hint:airport', label: 'airport hint', pos: [0, 0], hard: false }, 'procedural.airport.hint');

  // Connections: road stops, transit stops, routes, the pinned toggle.
  const C = sections.get('conn')!;
  const lbl = el('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = allowPinned;
  cb.onchange = () => { allowPinned = cb.checked; };
  lbl.append(cb, ' Allow moving pinned anchors (canal ends)');
  C.append(lbl);
  C.append(el('div', 'sub', 'Road stops'));
  for (const id of Object.keys((getAt(config, 'roads.stops') ?? {}) as object)) pointRow(C, id, { name: `stop:roads:${id}`, label: id, pos: [0, 0], hard: false }, `procedural.roads.stops.${id}`);
  C.append(el('div', 'sub', 'Metro stops'));
  for (const id of Object.keys((getAt(config, 'transit.stops') ?? {}) as object)) pointRow(C, id, { name: `stop:transit:${id}`, label: id, pos: [0, 0], hard: false }, `procedural.transit.stops.${id}`);
  C.append(el('div', 'sub', 'Road routes (stop ids, comma separated)'));
  for (const r of (getAt(config, 'roads.routes') ?? []) as { id: string; stops: string[] }[]) {
    const row = el('div', 'row');
    row.append(el('span', 'name', r.id));
    const t = document.createElement('input');
    t.style.gridColumn = '2 / 4';
    t.value = r.stops.join(', ');
    t.onchange = () => commit({ op: 'set-route', id: r.id, stops: t.value.split(',').map((x) => x.trim()).filter(Boolean) });
    row.append(t);
    C.append(row);
  }
  C.append(el('div', 'note', 'Linea 2 keeps its two-branch reading (guard linea-2-unchanged).'));

  // Changes vs authored.
  const ch = el('div', 'sub', 'Edits vs authored');
  C.append(ch);
  for (const e of accepted) C.append(el('div', 'note', `${short(e.path)}: ${JSON.stringify(getAt(baseProc, e.path.replace(/^procedural\./, '')))} → ${JSON.stringify(e.value)}`));
  if (!accepted.length) C.append(el('div', 'note', 'none'));

  refreshValues();
  if (keepScroll) side.scrollTop = top;
}
const findDoc = (path: string): ParamEntry['doc'] => params.find((x) => x.path.replace(/\[id=[^\]]+\]/g, '[*]') === path)?.doc;
function refreshValues(): void { for (const f of inputs.values()) f(); }

function renderMetrics(): void {
  const b = sections.get('result');
  if (!b) return;
  const m = metrics ?? {};
  const pick = ['urbanKm2', 'lakeKm2', 'riverKm', 'maxReliefM', 'airportToTownM', 'airportToDenseCoreM', 'roadsConnected', 'transitConnected', 'stations', 'townsKm2', 'districtsKm2'];
  const lines = pick.filter((k) => m[k] !== undefined).map((k) => `<b>${k}</b> ${JSON.stringify(m[k], (_, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))}`);
  b.innerHTML = lines.join('\n') + (violations.length ? '\n' + violations.map((v) => `<span class="viol">${v.guard}: ${v.message}</span>`).join('\n') : '\n<span style="color:var(--ok)">no guard violations</span>');
  b.style.whiteSpace = 'pre-wrap';
  b.style.font = '11px/1.4 ui-monospace, monospace';
}

// ---------------------------------------------------------------- toolbar, layers, keys
for (const [k, name] of Object.entries(layerNames)) {
  const l = el('label');
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = layers[k]!;
  c.onchange = () => { layers[k] = c.checked; draw(); };
  l.append(c, name);
  $('layers').append(l);
}
$('undo').onclick = () => { if (undo.length) restore(undo[undo.length - 1]!, undo, redo); };
$('redo').onclick = () => { if (redo.length) restore(redo[redo.length - 1]!, redo, undo); };
$('reset').onclick = () => { if (accepted.length) commit({ op: 'reset' }); };
$('fit').onclick = fit;
$('compare').onchange = () => {
  $('cmp').classList.toggle('on', ($('compare') as HTMLInputElement).checked);
  if (($('compare') as HTMLInputElement).checked && !before) {
    genLabel = 'rendering the authored map for compare…';
    setStatus();
    send('before', { op: 'preview', cell: FINE, metresPerPixel: 10 }, { then: (m) => { if (m.outcome.image) before = { canvas: toCanvas(m.outcome.image), tier: FINE }; genLabel = 'compare ready'; setStatus(); draw(); } });
  }
  draw();
};
$('split').oninput = () => { splitPos = Number(($('split') as HTMLInputElement).value) / 100; draw(); };
$('download').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([serialiseEdits(accepted)], { type: 'application/json' }));
  a.download = 'procedural-edits.json';
  a.click();
};
$('save').onclick = () => {
  gen++;
  genLabel = `saving: validating at ${FINE} m…`;
  setStatus();
  send('save', { op: 'save' }, {
    then: async (m) => {
      const r = m.outcome.response;
      if (!r.ok || !m.outcome.saved) {
        showMsg(`Save refused: ${r.errors.join('\n')}`, 'bad', 15000);
        genLabel = 'save refused';
        return setStatus();
      }
      try {
        const res = await fetch('/__studio/save', { method: 'POST', body: serialiseEdits(m.outcome.saved) });
        if (!res.ok) throw new Error(await res.text());
        showMsg(`Saved ${m.outcome.saved.length} edit(s) to specs/map/procedural-edits.json (validated at ${FINE} m).`, 'ok');
      } catch (e) {
        showMsg(`Validated but not written (${e instanceof Error ? e.message : e}). Use Download edits.`, 'bad');
      }
      genLabel = 'saved';
      setStatus();
      requestPreviews();
    },
  });
};
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  (e.shiftKey ? $('redo') : $('undo')).click();
});

// ---------------------------------------------------------------- boot
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.type === 'ready') {
    accepted = m.working;
    send('query', { op: 'describe' }, {
      then: (d) => {
        const data = d.outcome.response.data as { parameters: ParamEntry[]; districtPresets: Preset[] };
        params = data.parameters;
        presets = data.districtPresets;
        send('query', { op: 'export' }, { then: (x) => { config = (x.outcome.response.data as { config: Json }).config; renderInspector(); fit(); requestPreviews(); } });
      },
    });
    return;
  }
  const p = pending.get(m.id);
  pending.delete(m.id);
  if (m.type === 'dropped') return;
  if (m.type === 'error') {
    genLabel = `error: ${m.message}`;
    showMsg(`The generator failed: ${m.message}`, 'bad');
    return setStatus();
  }
  p?.then?.(m);
};
post({ type: 'init', yaml: worldYaml, savedJson });
setStatus();
