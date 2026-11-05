// Petites primitives géométriques (matrices affines au format PDF [a b c d e f]).

/** mul(a, b) renvoie la matrice qui applique b puis a (même convention que pdf.js Util.transform). */
export function mul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Boîte englobante (espace appareil) du rectangle [x0,y0,x1,y1] transformé par m. */
export function bboxOf(m, x0, y0, x1, y1) {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
}

export const width = (b) => b.r - b.x;
export const height = (b) => b.b - b.y;
export const area = (b) => Math.max(0, width(b)) * Math.max(0, height(b));

export function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.r, b.r), bb = Math.min(a.b, b.b);
  return r > x && bb > y ? { x, y, r, b: bb } : null;
}

export function union(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) };
}

export function expand(b, d) {
  return { x: b.x - d, y: b.y - d, r: b.r + d, b: b.b + d };
}

export function contains(outer, x, y) {
  return x >= outer.x && x <= outer.r && y >= outer.y && y <= outer.b;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
