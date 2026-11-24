#!/usr/bin/env node
// Macro-geography probe for the map reshape (docs/map-reshape/01-investigation/real-geography.md).
// Fetches AWS Terrain Tiles (terrarium) + a few Overpass queries, derives relief / streams / ridges /
// basins / flats, writes a JSON summary and a PNG preview. No dependencies (node:zlib PNG codec).
//   node tools/probe-macro-relief.mjs [--scale A|B|both] [--no-osm]
// Data: AWS Terrain Tiles (Mapzen terrarium; SRTM, etc.). © OpenStreetMap contributors (ODbL).
import { inflateSync, deflateSync } from 'node:zlib';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'macro');
const OUT = join(ROOT, 'docs/map-reshape/01-investigation/assets');
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WHICH = argOf('--scale', 'both');
const OSM = !args.includes('--no-osm');
const UA = 'transito-probe/1.0 (hobby game terrain study)';

const SCALES = {
  A: { name: 'isthmus', bbox: [-80.0, 8.9, -79.3, 9.4], z: 10, streamKm2: 25, basinKm2: 80, ridgeAcc: 60, peakR: 6000, up: 2 },
  B: { name: 'corridor', bbox: [-79.56, 8.98, -79.33, 9.15], z: 13, streamKm2: 1.5, basinKm2: 8, ridgeAcc: 400, peakR: 1500, up: 1 },
};

// ---------- PNG codec ----------
function readPng(buf) {
  let p = 8, w, h, ct, bd, idat = [], plte = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; if (d[12]) throw new Error('interlaced'); }
    else if (type === 'PLTE') plte = d; else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('bit depth ' + bd);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1, o = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[o + i - ch] : 0, b = y ? px[o - stride + i] : 0, c = i >= ch && y ? px[o - stride + i - ch] : 0;
      let v = raw[s + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + i] = v & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    if (ct === 3) { const k = px[i] * 3; rgb.set([plte[k], plte[k + 1], plte[k + 2]], i * 3); }
    else if (ch >= 3) rgb.set([px[i * ch], px[i * ch + 1], px[i * ch + 2]], i * 3);
    else rgb.set([px[i * ch], px[i * ch], px[i * ch]], i * 3);
  }
  return { w, h, rgb };
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
function writePng(w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'ascii'); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- tiles & grid ----------
const worldPx = (lon, lat, z) => { const n = 256 * 2 ** z, s = Math.sin(lat * Math.PI / 180); return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; };
const pxToLonLat = (x, y, z) => { const n = 256 * 2 ** z; return [x / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI]; };

async function tile(z, x, y) {
  const f = join(CACHE, `${z}-${x}-${y}.png`);
  if (!existsSync(f)) {
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`tile ${z}/${x}/${y}: ${r.status}`);
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return readPng(readFileSync(f));
}
async function buildGrid(bbox, z) {
  const [x0f, y1f] = worldPx(bbox[0], bbox[1], z), [x1f, y0f] = worldPx(bbox[2], bbox[3], z);
  const X0 = Math.floor(x0f), X1 = Math.ceil(x1f), Y0 = Math.floor(y0f), Y1 = Math.ceil(y1f);
  const W = X1 - X0, H = Y1 - Y0, hgt = new Float32Array(W * H);
  for (let ty = Math.floor(Y0 / 256); ty <= Math.floor((Y1 - 1) / 256); ty++) for (let tx = Math.floor(X0 / 256); tx <= Math.floor((X1 - 1) / 256); tx++) {
    const t = await tile(z, tx, ty);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const gx = tx * 256 + i - X0, gy = ty * 256 + j - Y0;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
      const k = (j * 256 + i) * 3; hgt[gy * W + gx] = t.rgb[k] * 256 + t.rgb[k + 1] + t.rgb[k + 2] / 256 - 32768;
    }
  }
  const latC = (bbox[1] + bbox[3]) / 2, cell = 40075016.686 / (256 * 2 ** z) * Math.cos(latC * Math.PI / 180);
  return { W, H, hgt, X0, Y0, z, cell, bbox,
    ll: (x, y) => pxToLonLat(X0 + x + 0.5, Y0 + y + 0.5, z),
    xy: (lon, lat) => { const [px, py] = worldPx(lon, lat, z); return [px - X0 - 0.5, py - Y0 - 0.5]; } };
}

// ---------- analysis ----------
const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const quant = (arr, qs) => { const a = Float64Array.from(arr).sort(); return Object.fromEntries(qs.map((q) => [q, +(a[Math.min(a.length - 1, Math.floor(q * a.length))] ?? NaN).toFixed(3)])); };
class Heap { // min-heap keyed by Float64 priority, payload int
  constructor() { this.k = []; this.v = []; }
  push(k, v) { let i = this.k.length; this.k.push(k); this.v.push(v); while (i) { const p = (i - 1) >> 1; if (this.k[p] <= k) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; } this.k[i] = k; this.v[i] = v; }
  pop() { const rk = this.k[0], rv = this.v[0], lk = this.k.pop(), lv = this.v.pop(), n = this.k.length; if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && this.k[c + 1] < this.k[c]) c++; if (this.k[c] >= lk) break; this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c; } this.k[i] = lk; this.v[i] = lv; } return rv; }
  get size() { return this.k.length; }
}

function analyse(g, cfg) {
  const { W, H, hgt, cell } = g, n = W * H, land = new Uint8Array(n);
  // sea = cells <= 0.5 m connected to the frame (tidal flats read 0 m, so they count as sea here;
  // inland pits <= 0.5 m stay land)
  land.fill(1); { const st = []; const add = (i) => { if (land[i] && hgt[i] <= 0.5) { land[i] = 0; st.push(i); } };
    for (let x = 0; x < W; x++) { add(x); add((H - 1) * W + x); } for (let y = 0; y < H; y++) { add(y * W); add(y * W + W - 1); }
    while (st.length) { const c = st.pop(), cx = c % W, cy = (c / W) | 0; if (cx > 0) add(c - 1); if (cx < W - 1) add(c + 1); if (cy > 0) add(c - W); if (cy < H - 1) add(c + W); } }
  // slope (rise/run), central differences
  const slope = new Float32Array(n);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, dx = (hgt[i + 1] - hgt[i - 1]) / (2 * cell), dy = (hgt[i + W] - hgt[i - W]) / (2 * cell);
    slope[i] = Math.hypot(dx, dy);
  }
  const landH = [], landS = [];
  for (let i = 0; i < n; i++) if (land[i]) { landH.push(hgt[i]); if (slope[i] > 0 || true) landS.push(slope[i] * 100); }
  const qs = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];
  // priority-flood (Barnes) from sea + frame; dir[i] = downstream cell
  const dir = new Int32Array(n).fill(-2), order = new Int32Array(n), seen = new Uint8Array(n), heap = new Heap(), filled = new Float64Array(n);
  let oc = 0;
  const seed = (i) => { if (!seen[i]) { seen[i] = 1; dir[i] = -1; filled[i] = hgt[i]; heap.push(hgt[i], i); } };
  for (let i = 0; i < n; i++) if (!land[i]) seed(i);
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  const EPS = 1e-3;
  while (heap.size) {
    const c = heap.pop(); order[oc++] = c; const cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy] of N8) {
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x; if (seen[j]) continue; seen[j] = 1; dir[j] = c;
      filled[j] = Math.max(hgt[j], filled[c] + EPS); heap.push(filled[j], j);
    }
  }
  const acc = new Float32Array(n).fill(1);
  for (let k = n - 1; k >= 0; k--) { const c = order[k]; if (dir[c] >= 0) acc[dir[c]] += acc[c]; }
  const cellKm2 = (cell / 1000) ** 2, thr = cfg.streamKm2 / cellKm2;
  const stream = new Uint8Array(n); let streamCells = 0;
  for (let i = 0; i < n; i++) if (land[i] && acc[i] >= thr) { stream[i] = 1; streamCells++; }
  // basins: mouth = last land cell before sea/frame
  const label = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) { const c = order[k]; if (!land[c]) continue; const d = dir[c]; label[c] = d < 0 || !land[d] ? c : label[d]; }
  const basins = [];
  for (let i = 0; i < n; i++) if (land[i] && label[i] === i && acc[i] * cellKm2 >= cfg.basinKm2) {
    const [lon, lat] = g.ll(i % W, (i / W) | 0); basins.push({ mouth: i, lon: +lon.toFixed(4), lat: +lat.toFixed(4), area_km2: +(acc[i] * cellKm2).toFixed(1), frame: (i % W < 2 || i % W > W - 3 || ((i / W) | 0) < 2 || ((i / W) | 0) > H - 3) });
  }
  basins.sort((a, b) => b.area_km2 - a.area_km2);
  const major = new Set(basins.map((b) => b.mouth)), divide = new Uint8Array(n);
  let divideCells = 0; const divH = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, a = label[i]; if (!land[i] || !major.has(a)) continue;
    for (const j of [i + 1, i + W]) { const b = label[j]; if (b !== a && land[j] && major.has(b)) { divide[i] = divide[j] = 1; divideCells++; divH.push(hgt[i]); break; } }
  }
  // ridges: uphill accumulation (steepest ascent), summit-ward
  const up = new Int32Array(n).fill(-1);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (!land[i]) continue; let best = 0, bj = -1;
    for (const [dx, dy] of N8) { const j = i + dy * W + dx, s = (hgt[j] - hgt[i]) / (Math.hypot(dx, dy)); if (s > best) { best = s; bj = j; } }
    up[i] = bj;
  }
  const asc = Array.from({ length: n }, (_, i) => i).filter((i) => land[i]).sort((a, b) => hgt[a] - hgt[b]);
  const racc = new Float32Array(n).fill(1);
  for (const i of asc) if (up[i] >= 0) racc[up[i]] += racc[i];
  const ridge = new Uint8Array(n); let ridgeCells = 0;
  for (let i = 0; i < n; i++) if (land[i] && racc[i] >= cfg.ridgeAcc && up[i] >= 0) { ridge[i] = 1; ridgeCells++; }
  // peaks: max in window, with min relief above the ring
  const R = Math.round(cfg.peakR / cell), peaks = [];
  const step = Math.max(1, R >> 2);
  for (let y = R; y < H - R; y += 1) for (let x = R; x < W - R; x += 1) {
    const i = y * W + x, h = hgt[i]; if (h < 60) continue; let ok = true;
    for (let dy = -R; dy <= R && ok; dy += step) for (let dx = -R; dx <= R; dx += step) if (hgt[i + dy * W + dx] > h) { ok = false; break; }
    if (!ok) continue;
    // exact check on the ring edge is skipped; dedupe below
    peaks.push(i);
  }
  const peakOut = []; peaks.sort((a, b) => hgt[b] - hgt[a]);
  for (const i of peaks) { const [lon, lat] = g.ll(i % W, (i / W) | 0); if (peakOut.every((p) => Math.hypot(p.lon - lon, p.lat - lat) > cfg.peakR / 111000)) peakOut.push({ lon: +lon.toFixed(4), lat: +lat.toFixed(4), h: +hgt[i].toFixed(0) }); if (peakOut.length >= 12) break; }
  // flats
  const flat10 = new Uint8Array(n); let f10 = 0, f10s = 0, landN = 0, f30 = 0;
  for (let i = 0; i < n; i++) if (land[i]) { landN++; if (hgt[i] < 10) { flat10[i] = 1; f10++; if (slope[i] < 0.02) f10s++; } if (hgt[i] < 30) f30++; }
  // inland distance of the 10 m / 30 m contour from the coast, along columns of every 0.02 deg lon (south coast)
  const transects = [];
  const lonStep = cfg === SCALES.A ? 0.05 : 0.02;
  for (let lon = Math.ceil(g.bbox[0] / lonStep) * lonStep; lon < g.bbox[2]; lon += lonStep) {
    const x = Math.round(g.xy(lon, 9)[0]); if (x < 1 || x >= W - 1) continue;
    // walk north from the southern coast (first land cell from the south edge)
    let y = H - 1; while (y > 0 && !land[y * W + x]) y--;
    if (y <= 0 || y < H * 0.05) { continue; }
    const coastY = y; let d10 = null, d30 = null, d100 = null;
    for (let k = 0; coastY - k > 0; k++) { const hh = hgt[(coastY - k) * W + x]; if (d10 === null && hh >= 10) d10 = k * cell; if (d30 === null && hh >= 30) d30 = k * cell; if (d100 === null && hh >= 100) { d100 = k * cell; break; } }
    transects.push({ lon: +lon.toFixed(3), coast_lat: +g.ll(x, coastY)[1].toFixed(4), to10m_m: d10 && Math.round(d10), to30m_m: d30 && Math.round(d30), to100m_m: d100 && Math.round(d100) });
  }
  return { n, land, slope, hgt, acc, stream, streamCells, thr, label, basins, divide, divideCells, divH, ridge, ridgeCells, peaks: peakOut, flat10, summary: {
    cell_m: +cell.toFixed(1), grid: [W, H], land_km2: +(landN * cellKm2).toFixed(0),
    height_land_q: quant(landH, qs), slope_land_pct_q: quant(landS, qs),
    share_land_below: { '10m': +(f10 / landN).toFixed(3), '30m': +(f30 / landN).toFixed(3) },
    flat_lt10m_km2: +(f10 * cellKm2).toFixed(0), flat_lt10m_slope_lt2pct_km2: +(f10s * cellKm2).toFixed(0),
    height_max_m: +landH.reduce((m, v) => Math.max(m, v), -1e9).toFixed(0),
    stream_threshold_km2: cfg.streamKm2, stream_km: +(streamCells * cell / 1000).toFixed(0),
    ridge_km: +(ridgeCells * cell / 1000).toFixed(0), divide_km: +(divideCells * cell / 1000).toFixed(0), divide_height_q: divH.length ? quant(divH, [0.1, 0.5, 0.9]) : null,
    peaks: peakOut, basins: basins.slice(0, 14), coast_transects: transects } };
}

// ---------- OSM ----------
async function overpass(name, q) {
  const f = join(CACHE, `osm-${name}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  await new Promise((r) => setTimeout(r, 2000));
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
  if (!r.ok) throw new Error(`overpass ${name}: ${r.status}`);
  const j = await r.json(); writeFileSync(f, JSON.stringify(j)); return j;
}
const bb = (b) => `${b[1]},${b[0]},${b[3]},${b[2]}`;
async function osmFetch() {
  const A = SCALES.A.bbox, B = SCALES.B.bbox;
  const water = await overpass('water', `[out:json][timeout:120];(way["waterway"~"^(river|canal)$"]["name"](${bb(A)});way["waterway"="stream"]["name"](${bb(B)}););out tags geom;`);
  const nat = await overpass('nature', `[out:json][timeout:120];(way["natural"="wetland"](${bb(B)});way["natural"="wood"]["name"](${bb(B)});way["wetland"="mangrove"](${bb(B)});node["natural"="peak"](${bb(A)});node["place"~"^(city|town|suburb|village|neighbourhood)$"](${bb(B)});way["highway"~"^(motorway|trunk)$"]["name"](${bb(A)}););out tags geom;`);
  const lu = await overpass('landuse', `[out:json][timeout:180];(way["landuse"~"^(residential|commercial|industrial|retail)$"](${bb(B)}););out tags geom;`);
  return { water, nat, lu };
}
const lines = (els, pred) => els.filter((e) => e.type === 'way' && e.geometry && pred(e.tags || {})).map((e) => ({ tags: e.tags, pts: e.geometry.map((p) => [p.lon, p.lat]) }));
function rasterPolys(g, polys) {
  const m = new Uint8Array(g.W * g.H);
  for (const p of polys) {
    const pts = p.pts.map(([lo, la]) => g.xy(lo, la)); if (pts.length < 4) continue;
    let ymin = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[1])))), ymax = Math.min(g.H - 1, Math.ceil(Math.max(...pts.map((q) => q[1]))));
    for (let y = ymin; y <= ymax; y++) {
      const xs = [];
      for (let i = 0; i < pts.length - 1; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]; if ((y1 <= y) !== (y2 <= y)) xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(g.W - 1, Math.floor(xs[k + 1])); x++) m[y * g.W + x] = 1;
    }
  }
  return m;
}
function compareRivers(g, a, rivers) {
  const byName = new Map();
  for (const r of rivers) { const k = r.tags.name; (byName.get(k) || byName.set(k, []).get(k)).push(r); }
  const rows = [], tol = Math.round(300 / g.cell);
  for (const [name, rs] of byName) {
    let tot = 0, hit = 0, lenKm = 0, dsum = 0, inside = 0;
    for (const r of rs) {
      for (let i = 0; i < r.pts.length; i++) {
        const [x, y] = g.xy(...r.pts[i]); const cx = Math.round(x), cy = Math.round(y);
        if (cx < 1 || cy < 1 || cx >= g.W - 1 || cy >= g.H - 1) continue; inside++;
        if (i) { const [lo, la] = r.pts[i - 1], [lo2, la2] = r.pts[i]; lenKm += Math.hypot((lo2 - lo) * 109.8, (la2 - la) * 111); }
        let best = 1e9; for (let dy = -tol; dy <= tol; dy++) for (let dx = -tol; dx <= tol; dx++) { const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= g.W || yy >= g.H) continue; if (a.stream[yy * g.W + xx]) best = Math.min(best, Math.hypot(dx, dy)); }
        tot++; if (best <= tol) { hit++; dsum += best; }
      }
    }
    if (tot >= 3) rows.push({ name, osm_km_in_bbox: +lenKm.toFixed(1), pts: tot, share_within_300m_of_D8: +(hit / tot).toFixed(2) });
  }
  return rows.sort((p, q) => q.osm_km_in_bbox - p.osm_km_in_bbox);
}

// ---------- render ----------
function render(g, a, extra, file, up) {
  const { W, H } = g, w = W * up, h = H * up, img = new Uint8Array(w * h * 3), z = 2.5;
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) img.set(c, (y * w + x) * 3); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let c;
    if (!a.land[i]) c = [170, 200, 225];
    else {
      const gx = x > 0 && x < W - 1 ? (a.hgt[i + 1] - a.hgt[i - 1]) / (2 * g.cell) : 0, gy = y > 0 && y < H - 1 ? (a.hgt[i + W] - a.hgt[i - W]) / (2 * g.cell) : 0;
      let sh = 0.5 + z * 0.7 * (gx * 0.7 + gy * 0.7) * (up === 1 ? 4 : 10) / 4; sh = Math.max(0.1, Math.min(1, sh));
      const t = Math.min(1, a.hgt[i] / 400), base = [140 + 70 * t, 170 + 30 * t - 20 * t * t, 110 + 60 * t];
      c = base.map((v) => v * (0.45 + 0.7 * sh));
      if (a.flat10[i]) c = [c[0] * 0.75, c[1] * 1.0, c[2] * 0.8 + 25];
      if (extra.urban?.[i]) c = [c[0] * 0.6 + 100, c[1] * 0.6 + 60, c[2] * 0.6 + 40];
    }
    for (let dy = 0; dy < up; dy++) for (let dx = 0; dx < up; dx++) set(x * up + dx, y * up + dy, c.map((v) => Math.max(0, Math.min(255, v))));
  }
  const dot = (i, c, s = up) => { const x = (i % W) * up, y = ((i / W) | 0) * up; for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) set(x + dx, y + dy, c); };
  for (let i = 0; i < a.n; i++) { if (a.ridge[i]) dot(i, [230, 150, 30], Math.max(1, up - 1) || 1); if (a.divide[i]) dot(i, [255, 255, 255]); if (a.stream[i] && a.land[i]) dot(i, [20, 60, 220]); }
  for (const r of extra.rivers || []) for (let k = 1; k < r.pts.length; k++) { const [x1, y1] = g.xy(...r.pts[k - 1]), [x2, y2] = g.xy(...r.pts[k]); const s = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * up); for (let t = 0; t <= s; t++) set(Math.round((x1 + (x2 - x1) * t / s) * up), Math.round((y1 + (y2 - y1) * t / s) * up), [230, 20, 200]); }
  for (const r of extra.roads || []) for (let k = 1; k < r.pts.length; k++) { const [x1, y1] = g.xy(...r.pts[k - 1]), [x2, y2] = g.xy(...r.pts[k]); const s = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * up); for (let t = 0; t <= s; t++) set(Math.round((x1 + (x2 - x1) * t / s) * up), Math.round((y1 + (y2 - y1) * t / s) * up), [250, 230, 40]); }
  writeFileSync(file, writePng(w, h, img));
}

// ---------- engine sanity check (fragment profiles already carry engine elevation stats) ----------
function fragmentCheck(g) {
  const dir = join(ROOT, 'specs/map/fragments'), rows = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.yaml') && !['index.yaml'].includes(x))) {
    const t = readFileSync(join(dir, f), 'utf8'), m = t.match(/bbox: \[(-?[\d.]+), ([\d.]+), (-?[\d.]+), ([\d.]+)\]/);
    if (!m) continue; const b = m.slice(1).map(Number); if (b[0] > -79 || b[0] < -80) continue; // Panama only
    const num = (k) => +(t.match(new RegExp(`${k}: ([\\d.]+)`)) || [])[1];
    const [xa, yb] = g.xy(b[0], b[1]), [xb, ya] = g.xy(b[2], b[3]), hs = [];
    for (let y = Math.max(0, Math.floor(ya)); y < Math.min(g.H, Math.ceil(yb)); y++) for (let x = Math.max(0, Math.floor(xa)); x < Math.min(g.W, Math.ceil(xb)); x++) hs.push(g.hgt[y * g.W + x]);
    if (!hs.length) continue; const q = quant(hs, [0.5]);
    rows.push({ fragment: f.replace('.yaml', ''), engine_p50: num('height_p50_m'), probe_p50: +q[0.5].toFixed(1), engine_min: num('height_min_m'), probe_min: +Math.min(...hs).toFixed(1), engine_max: num('height_max_m'), probe_max: +Math.max(...hs).toFixed(1) });
  }
  return rows;
}

// ---------- compression mapping: similarity fit real lon/lat -> spec meters ----------
let CORRIDOR_MAP = null;
function fit(anchors) {
  const k = 111.0, pts = anchors.map((a) => ({ ...a, e: (a.lon + 79.5) * k * Math.cos(9.05 * Math.PI / 180) * 1000, n: (a.lat - 9.05) * k * 1000 }));
  const m = (f) => pts.reduce((s, p) => s + f(p), 0) / pts.length, me = m((p) => p.e), mn = m((p) => p.n), mx = m((p) => p.x), my = m((p) => p.y);
  let a = 0, b = 0, d = 0; // complex least squares: (x+iy) = s e^{i th} (e+in)
  for (const p of pts) { const e = p.e - me, nn = p.n - mn, x = p.x - mx, y = p.y - my; a += e * x + nn * y; b += e * y - nn * x; d += e * e + nn * nn; }
  const s = Math.hypot(a, b) / d, th = Math.atan2(b, a);
  const toMap = (lon, lat) => { const e = (lon + 79.5) * k * Math.cos(9.05 * Math.PI / 180) * 1000 - me, nn = (lat - 9.05) * k * 1000 - mn; return [Math.round(s * (Math.cos(th) * e - Math.sin(th) * nn) + mx), Math.round(s * (Math.sin(th) * e + Math.cos(th) * nn) + my)]; };
  CORRIDOR_MAP = toMap;
  const res = pts.map((p) => { const e = p.e - me, nn = p.n - mn, px = s * (Math.cos(th) * e - Math.sin(th) * nn) + mx, py = s * (Math.sin(th) * e + Math.cos(th) * nn) + my; return { id: p.id, residual_m: Math.round(Math.hypot(px - p.x, py - p.y)) }; });
  return { scale_map_per_real: +s.toFixed(3), centroid_real_east_north_m: [Math.round(me), Math.round(mn)], centroid_map_xy: [Math.round(mx), Math.round(my)], east_north_from: 'e=(lon+79.5)*111.0*cos(9.05deg)*1000, n=(lat-9.05)*111.0*1000', ratio: `1:${(1 / s).toFixed(1)}`, rotation_deg_ccw: +(th * 180 / Math.PI).toFixed(0), residuals: res };
}
const CORRIDOR_ANCHORS = [
  { id: 'miguelito-hills~Samaria', lon: -79.494, lat: 9.051, x: 4500, y: 3400 },
  { id: 'corridor-market~Juan Diaz', lon: -79.459, lat: 9.0325, x: 4600, y: 2400 },
  { id: 'tito-home~Pedregal', lon: -79.427, lat: 9.073, x: 5400, y: 2600 },
  { id: 'passenger-terminal~Tocumen terminal', lon: -79.386, lat: 9.071, x: 5600, y: 1700 },
];
const ISTHMUS_ANCHORS = [ // lon/lat -> spec (x, y) piecewise per axis
  { id: 'Colon', lon: -79.900, lat: 9.359, x: 1750, y: 7050 }, { id: 'Gatun locks', lon: -79.918, lat: 9.270, x: 500, y: 6500 },
  { id: 'Gamboa', lon: -79.700, lat: 9.120, x: 1300, y: 3600 }, { id: 'Miraflores', lon: -79.595, lat: 8.996, x: 1400, y: 1500 },
  { id: 'Casco Viejo', lon: -79.535, lat: 8.953, x: 2400, y: 400 }, { id: 'Tocumen terminal', lon: -79.386, lat: 9.071, x: 5600, y: 1700 },
];

// ---------- main ----------
const osm = OSM ? await osmFetch() : null;
const result = { generated_by: 'tools/probe-macro-relief.mjs', attribution: ['AWS Terrain Tiles (Mapzen terrarium; SRTM, etc.)', '© OpenStreetMap contributors'], mapping: { corridor_fit: fit(CORRIDOR_ANCHORS), isthmus_anchors: ISTHMUS_ANCHORS } };
for (const key of WHICH === 'both' ? ['A', 'B'] : [WHICH]) {
  const cfg = SCALES[key], g = await buildGrid(cfg.bbox, cfg.z), a = analyse(g, cfg);
  const extra = {}; const s = a.summary; s.bbox = cfg.bbox; s.zoom = cfg.z;
  if (osm) {
    const all = [...osm.water.elements, ...osm.nat.elements];
    const rivers = lines(osm.water.elements, (t) => t.waterway === 'river' || t.waterway === 'stream');
    extra.rivers = rivers; extra.roads = lines(osm.nat.elements, (t) => /^(motorway|trunk)$/.test(t.highway));
    s.river_vs_D8 = compareRivers(g, a, rivers).slice(0, 40);
    s.canals = [...new Set(lines(osm.water.elements, (t) => t.waterway === 'canal').map((r) => r.tags.name))];
    s.osm_peaks = osm.nat.elements.filter((e) => e.type === 'node' && e.tags?.natural === 'peak' && e.lon > cfg.bbox[0] && e.lon < cfg.bbox[2] && e.lat > cfg.bbox[1] && e.lat < cfg.bbox[3]).map((e) => ({ name: e.tags.name || '(unnamed)', lon: +e.lon.toFixed(4), lat: +e.lat.toFixed(4), ele: e.tags.ele })).sort((p, q) => (+q.ele || 0) - (+p.ele || 0)).slice(0, 15);
    s.highways = [...new Set(lines(osm.nat.elements, (t) => /^(motorway|trunk)$/.test(t.highway)).map((r) => r.tags.name + ' [' + r.tags.highway + ']'))];
    if (key === 'B') {
      const wet = lines(osm.nat.elements, (t) => t.natural === 'wetland' || t.wetland === 'mangrove');
      const wm = rasterPolys(g, wet), lu = rasterPolys(g, lines(osm.lu.elements, () => true)); extra.urban = lu;
      let wc = 0, wlow = 0; for (let i = 0; i < a.n; i++) if (wm[i]) { wc++; if (a.hgt[i] < 10) wlow++; }
      s.osm_wetland_km2 = +(wc * (g.cell / 1000) ** 2).toFixed(1); s.osm_wetland_share_below_10m = wc ? +(wlow / wc).toFixed(2) : null; s.osm_wetland_polygons = wet.length;
      const hist = (mask) => { const sl = [], hh = []; for (let i = 0; i < a.n; i++) if (a.land[i] && mask(i)) { sl.push(a.slope[i] * 100); hh.push(a.hgt[i]); } return { cells_km2: +(sl.length * (g.cell / 1000) ** 2).toFixed(1), slope_pct_q: quant(sl, [0.1, 0.5, 0.9, 0.99]), height_q: quant(hh, [0.1, 0.5, 0.9, 0.99]), share_slope_gt_15pct: +(sl.filter((v) => v > 15).length / sl.length).toFixed(3) }; };
      s.urban_mask = { source: 'OSM landuse residential|commercial|industrial|retail (ways only; relations skipped)', polygons: osm.lu.elements.length, urban: hist((i) => lu[i]), non_urban_land: hist((i) => !lu[i]) };
      s.places = osm.nat.elements.filter((e) => e.type === 'node' && e.tags?.place).map((e) => { const [x, y] = g.xy(e.lon, e.lat), i = Math.round(y) * g.W + Math.round(x); return { name: e.tags.name, place: e.tags.place, lon: +e.lon.toFixed(4), lat: +e.lat.toFixed(4), h: +(a.hgt[i] ?? NaN).toFixed(0), slope_pct: +((a.slope[i] ?? NaN) * 100).toFixed(1) }; }).filter((p) => !isNaN(p.h)).sort((p, q) => p.lon - q.lon);
    }
  }
  if (key === 'B') { s.basins.forEach((b) => { b.map_xy = CORRIDOR_MAP(b.lon, b.lat); }); s.peaks.forEach((b) => { b.map_xy = CORRIDOR_MAP(b.lon, b.lat); }); s.places = (s.places || []).filter((p) => /^(Juan Díaz|Pedregal|Tocumen|Samaria|San Miguelito|Las Mañanitas|Torrijos Carter|Nuevo Tocumen|Río Abajo|Panamá La Vieja|Cerro Viento|Belén|24 de Diciembre|Alcalde Díaz|Chanis)$/.test(p.name)).map((p) => ({ ...p, map_xy: CORRIDOR_MAP(p.lon, p.lat) })); }
  s.fragment_check = fragmentCheck(g);
  result[key] = s;
  render(g, a, extra, join(OUT, `macro-${cfg.name}.png`), cfg.up);
  console.log(`${key} ${cfg.name}: ${g.W}x${g.H} cells of ${g.cell.toFixed(0)} m, streams ${s.stream_km} km`);
}
writeFileSync(join(OUT, 'macro-summary.json'), JSON.stringify(result, null, 1));
console.log('wrote', join(OUT, 'macro-summary.json'));
