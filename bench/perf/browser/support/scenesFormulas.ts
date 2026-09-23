// Inputs of the shared-formula equivalence bench: drawn from a seed, and deliberately
// hostile. A factorization that would only hold on well-behaved numbers would fail here — NaN,
// -0, infinities, denormals, singular matrices, inverted boxes, zero-area triangles.
import { graine } from '../../../core/index.ts';

const alea = graine(40961);
/** Values a float can take that a formula must traverse without smoothing them. */
const BORDS = [0, -0, 1, -1, Infinity, -Infinity, NaN, 5e-324, Number.MIN_VALUE, 1e308, -1e308];
const nombre = () => {
  if (alea() < 0.12) return BORDS[Math.floor(alea() * BORDS.length)];
  return (alea() * 2 - 1) * 10 ** Math.floor(alea() * 12 - 6);
};

/** Six planes per set, some degenerate, and the box each one tests. */
export const casPlans: { planes: Float64Array; boite: number[] }[] = [];
for (let i = 0; i < 400; i++) {
  const planes = new Float64Array(24);
  for (let k = 0; k < 24; k++) planes[k] = i % 17 === 0 ? nombre() : alea() * 4 - 2;
  const c = [alea() * 20 - 10, alea() * 20 - 10, alea() * 20 - 10];
  const e = i % 11 === 0 ? 0 : alea() * 5;
  const boite = [c[0] - e, c[1] - e, c[2] - e, c[0] + e, c[1] + e, c[2] + e];
  if (i % 23 === 0) boite[0] = NaN;
  if (i % 29 === 0) boite[3] = -Infinity;
  casPlans.push({ planes, boite });
}

/** Screen triangles: ordinary, off-screen, degenerate, and some with non-finite vertex. The
 *  world coordinates are never read by the formulas under test; they are carried only to match
 *  `Projected`, the real functions' parameter type. */
const point = (i: number) => ({
  x: i % 19 === 0 ? nombre() : alea() * 2000 - 500,
  y: i % 23 === 0 ? nombre() : alea() * 2000 - 500,
  z: alea(),
  invW: alea(),
  worldX: 0,
  worldY: 0,
  worldZ: 0,
});
type PointFormule = ReturnType<typeof point>;
export const triangles: {
  a: PointFormule;
  b: PointFormule;
  c: PointFormule;
  x: number;
  y: number;
}[] = [];
for (let i = 0; i < 3000; i++) {
  const a = point(i),
    b = point(i + 1),
    c = i % 37 === 0 ? { ...a } : point(i + 2);
  triangles.push({ a, b, c, x: alea() * 1000 - 100, y: alea() * 1000 - 100 });
}

/** Page table row ranks, up to over a million. */
export const rangs: number[] = [];
for (let i = 0; i < 2000; i++) rangs.push(i % 17 === 0 ? Math.floor(alea() * 1e7) : i);

/** Logical sizes and pixel ratios the host sets, `undefined` included. */
export const tailles: { logical: number; ratio: number | undefined }[] = [];
for (let i = 0; i < 2000; i++)
  tailles.push({
    logical: i % 13 === 0 ? nombre() : Math.floor(alea() * 4000),
    ratio: i % 5 === 0 ? undefined : alea() * 4,
  });

/** Durations in nanoseconds that the two GPU timers yield. */
export const durees: number[] = [];
for (let i = 0; i < 2000; i++) durees.push(i % 7 === 0 ? nombre() : alea() * 1e12);

/** Extents from which the bench takes the model floor, including those that straddle zero. */
export const emprises: {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}[] = [];
for (let i = 0; i < 1000; i++) {
  const y0 = alea() * 20 - 10,
    y1 = y0 + alea() * 20;
  emprises.push({
    min: { x: 0, y: i % 11 === 0 ? nombre() : y0, z: 0 },
    max: { x: 1, y: i % 13 === 0 ? nombre() : y1, z: 1 },
  });
}
