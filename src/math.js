export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const lerp = (a, b, t) => a + (b - a) * t;

export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export function approach(value, target, maxDelta) {
  if (value < target) return Math.min(value + maxDelta, target);
  if (value > target) return Math.max(value - maxDelta, target);
  return target;
}

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

export const randInt = (a, b) => Math.floor(rand(a, b + 1));

export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(a, b = 0) {
  const h = Math.sin(a * 127.1 + b * 311.7 + 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

export function aabbOverlap(a, b) {
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) * 0.5 &&
    Math.abs(a.y - b.y) < (a.l + b.l) * 0.5
  );
}

export function circleRectOverlap(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x - rect.w * 0.5, rect.x + rect.w * 0.5);
  const ny = clamp(cy, rect.y - rect.l * 0.5, rect.y + rect.l * 0.5);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function shortAngleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
