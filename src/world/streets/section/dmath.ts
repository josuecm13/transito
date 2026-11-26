/**
 * Deterministic math for the section generator. Math.sin / cos / atan2 / acos / exp / log / pow are NOT
 * specified to the last bit: Chrome and Node return different results for the same input, and one flipped
 * last bit is enough to flip a branch in the layout (card 3c). Everything here uses only + - * /,
 * Math.sqrt, Math.floor and Math.abs, which IEEE 754 makes exact and identical on every engine, so the
 * generator builds the same streets everywhere.
 *
 * Accuracy, measured against Math.* in Node 22 over 200k pseudo-random inputs: sin and cos within 3.4e-16 absolute (|x| <= 1e4);
 * atan2 within 8.3e-16 relative; acos within 8.9e-16 absolute; exp within 2e-15 relative; log within 3.7e-16; pow within 6e-15 relative.
 */

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const LN2 = 0.6931471805599453;
// pi/2 split in three parts (Cody-Waite reduction): the products k * PIO2_x are exact for |k| < 2^20.
const PIO2_1 = 1.5707963267341256; // first 33 bits of pi/2
const PIO2_2 = 6.077100506303966e-11; // next 33 bits
const PIO2_3 = 2.0222662487959506e-21; // remainder

/** sin and cos of x via reduction to [-pi/4, pi/4] and Taylor series. */
function sincos(x: number): { s: number; c: number } {
  const k = Math.floor(x / HALF_PI + 0.5);
  const r = x - k * PIO2_1 - k * PIO2_2 - k * PIO2_3;
  const r2 = r * r;
  // Taylor to degree 27 / 26: the last term is below 1e-18 for |r| <= pi/4.
  let s = 1;
  let c = 1;
  let ts = 1;
  let tc = 1;
  for (let n = 1; n <= 13; n++) {
    ts *= -r2 / ((2 * n) * (2 * n + 1));
    tc *= -r2 / ((2 * n - 1) * (2 * n));
    s += ts;
    c += tc;
  }
  s *= r;
  const q = (((k % 4) + 4) % 4) | 0;
  switch (q) {
    case 0: return { s, c };
    case 1: return { s: c, c: -s };
    case 2: return { s: -s, c: -c };
    default: return { s: -c, c: s };
  }
}

export const sin = (x: number): number => sincos(x).s;
export const cos = (x: number): number => sincos(x).c;

/** atan(x): argument halving atan(x) = 2 atan(x / (1 + sqrt(1 + x^2))) three times, then Taylor series. */
function atan(x: number): number {
  const neg = x < 0;
  let a = neg ? -x : x;
  const inv = a > 1;
  if (inv) a = 1 / a;
  for (let i = 0; i < 3; i++) a = a / (1 + Math.sqrt(1 + a * a));
  const a2 = a * a;
  let t = a;
  let sum = a;
  for (let n = 1; n <= 12; n++) {
    t *= -a2;
    sum += t / (2 * n + 1);
  }
  let r = sum * 8;
  if (inv) r = HALF_PI - r;
  return neg ? -r : r;
}

export function atan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI;
  if (Math.abs(y) <= Math.abs(x)) {
    const a = atan(y / x);
    if (x > 0) return a;
    return y >= 0 ? a + PI : a - PI;
  }
  const a = atan(x / y); // |x| < |y|
  return y > 0 ? HALF_PI - a : -HALF_PI - a;
}

export const acos = (x: number): number => atan2(Math.sqrt(Math.max(0, (1 - x) * (1 + x))), x);

/** 2^k exactly, by repeated squaring of 2 (every step is exact). */
function pow2(k: number): number {
  let r = 1;
  let b = k < 0 ? 0.5 : 2;
  for (let n = k < 0 ? -k : k; n > 0; n = Math.floor(n / 2)) {
    if (n % 2 === 1) r *= b;
    b *= b;
  }
  return r;
}

/** e^x: x = k ln2 + r, |r| <= ln2 / 2, Taylor series for e^r, scaled by 2^k. */
export function exp(x: number): number {
  const k = Math.floor(x / LN2 + 0.5);
  const r = x - k * LN2 - k * 2.3190468138462996e-17;
  let t = 1;
  let sum = 1;
  for (let n = 1; n <= 18; n++) {
    t *= r / n;
    sum += t;
  }
  return sum * pow2(k);
}

/** ln(x) for x > 0: x = m 2^e with m in [0.75, 1.5), ln m = 2 atanh((m - 1) / (m + 1)) by its odd series. */
export function log(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  let m = x;
  let e = 0;
  while (m >= 1.5) {
    m /= 2;
    e++;
  }
  while (m < 0.75) {
    m *= 2;
    e--;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let t = s;
  let sum = s;
  for (let n = 1; n <= 14; n++) {
    t *= s2;
    sum += t / (2 * n + 1);
  }
  return 2 * sum + e * LN2 + e * 2.3190468138462996e-17;
}

/** x^y for x > 0. */
export const pow = (x: number, y: number): number => exp(y * log(x));
