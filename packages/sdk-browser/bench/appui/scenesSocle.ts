// Inputs of the math-foundation bench: drawn from a seed and deliberately hostile. A
// formula that would only hold on well-behaved matrices would fail here — negative and
// non-uniform scales, singular matrices, NaN, signed zeros, infinities, denormals.
import * as THREE from 'three';
import { graine } from '../../../sdk-core/bench/socle.ts';

const alea = graine(0x50c1e);
/** Values a float can take that a formula must traverse without smoothing them. */
export const BORDS = [0, -0, 1, -1, Infinity, -Infinity, NaN, 5e-324, 1e308, -1e308, 0.5, -0.5];
const bord = () => BORDS[Math.floor(alea() * BORDS.length)];
const nombre = () => (alea() < 0.15 ? bord() : (alea() * 2 - 1) * 10 ** Math.floor(alea() * 8 - 4));

/** A rigid pose, then a scale drawn from: uniform, non-uniform, negative, zero. */
function pose(i: number) {
  const q = new THREE.Quaternion(alea() - 0.5, alea() - 0.5, alea() - 0.5, alea() - 0.5);
  q.normalize();
  const echelles = [
    [1, 1, 1],
    [2, 2, 2],
    [0.25, 3, 7],
    [-1, 1, 1],
    [-2, -0.5, 4],
    [0, 1, 1],
    [1e-300, 1, 1],
  ];
  const s = echelles[i % echelles.length];
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(alea() * 200 - 100, alea() * 200 - 100, alea() * 200 - 100),
    q,
    new THREE.Vector3(s[0], s[1], s[2]),
  );
  return Float64Array.from(m.elements);
}

/** Matrices: affine poses, then fully drawn, then sprinkled with edges across the whole matrix. */
export const matrices: Float64Array[] = [];
for (let i = 0; i < 400; i++) matrices.push(pose(i));
for (let i = 0; i < 300; i++) {
  const m = new Float64Array(16);
  for (let k = 0; k < 16; k++) m[k] = i % 3 === 0 ? nombre() : alea() * 4 - 2;
  matrices.push(m);
}
for (let i = 0; i < 12 * 16; i++) {
  const m = pose(i);
  m[i % 16] = BORDS[i % BORDS.length];
  matrices.push(m);
}
/** Pure-edge matrices: signed zeros, units and non-finites mixed on every entry. */
for (let i = 0; i < 200; i++) matrices.push(Float64Array.from({ length: 16 }, bord));
matrices.push(new Float64Array(16), new Float64Array(16).fill(-0));

/**
 * The same, ROUNDED to single precision but held in double: that is how a render buffer
 * enters the foundation from this batch. The product only reads and writes one buffer type
 * (`mathMatrix4.ts`), and conversion to single precision happens at SEND, on the result. The
 * values themselves are exactly those of a `Float32Array`, hence the same bits as before.
 */
const matrices32 = matrices.map((m) => Float64Array.from(Float32Array.from(m)));

/** Affines only: last row exactly `(0, 0, 0, 1)`, the domain of a node pose. */
export const affines = matrices.filter(
  (m) => m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1,
);

/** Ordinary points, then edge points. */
export const points: number[][] = [];
for (let i = 0; i < 1500; i++)
  points.push([alea() * 400 - 200, alea() * 400 - 200, alea() * 400 - 200]);
for (let i = 0; i < 300; i++) points.push([nombre(), nombre(), nombre()]);
for (const a of BORDS) for (const b of BORDS) points.push([a, b, -0]);

/** Matrix pairs that the products receive: each matrix against a neighbour. */
export const paires = matrices.map((a, i) => [a, matrices[(i * 7 + 3) % matrices.length]]);
export const paires32 = matrices32.map((a, i) => [a, matrices32[(i * 7 + 3) % matrices32.length]]);
