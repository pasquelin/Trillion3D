// A duel between Three.js and sdk-core on one calculation family: same seeded inputs, both sides
// timed on their own operation alone, Three's result — read untimed — the oracle of the engine's.
// Three serves as the witness only, never inside a `math*.ts` file.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { copyMatrix4 } from '../../../packages/sdk-core/src/math/matrix/matrix4.ts';
import { graine, mesure } from '../../core/index.ts';
import { compteur, note } from '../../core/ulp.ts';

/** Elements per line: enough to leave the JIT warm and the caches cold, like a frame's batches. */
export const N = 200000;
export const alea = graine(19092026);
export const rnd = (a = -10, b = 10) => a + alea() * (b - a);

/**
 * The reference rounds the sRGB constants (`c · 0.0773993808`, `c · 0.9478672986 + 0.0521327014`)
 * where the engine writes the curve (`mathColor.ts`); the largest gap this leaves, declared once
 * for every bench that measures it.
 */
export const SRGB_REFERENCE_GAP = 1e-10;
/**
 * Three's reverse curve uses exponent 0.41666 instead of 1 / 2.4. On [0, 1], the mean-value
 * theorem bounds the gap by 1.055 * abs(1 / 2.4 - 0.41666) / (Math.E * 0.41666) < 6.3e-6.
 * This is a different direction from SRGB_REFERENCE_GAP; the engine keeps its exact exponent.
 */
export const LINEAR_SRGB_REFERENCE_GAP = 6.3e-6;

/** A unit quaternion from four seeded draws. */
export const quaternion = () => new THREE.Quaternion(rnd(), rnd(), rnd(), rnd()).normalize();

/** One view of `stride` numbers per element, built once, outside every chronometer. */
export const views = (flat: Float64Array, stride: number) =>
  Array.from({ length: flat.length / stride }, (_, i) =>
    flat.subarray(i * stride, i * stride + stride),
  );

/** `n` random translation-rotation-scale matrices: Three objects, one flat buffer, one view each. */
export function trsMatrices(n: number) {
  const three: THREE.Matrix4[] = [];
  const flat = new Float64Array(n * 16);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(rnd(), rnd(), rnd()),
      quaternion(),
      new THREE.Vector3(rnd(0.2, 3), rnd(0.2, 3), rnd(0.2, 3)),
    );
    three.push(m);
    copyMatrix4(flat, m.elements, i * 16);
  }
  return { three, flat, views: views(flat, 16) };
}

/** `n` random points as Three vectors and one flat buffer. */
export function points(n: number, low = -10, high = 10) {
  const three: THREE.Vector3[] = [];
  const flat = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rnd(low, high), rnd(low, high), rnd(low, high));
    three.push(v);
    flat[i * 3] = v.x;
    flat[i * 3 + 1] = v.y;
    flat[i * 3 + 2] = v.z;
  }
  return { three, flat };
}

/**
 * Three's matrices or vectors read flat, `stride` numbers each: the form the engine's result
 * takes. `stride` alone tells which of the two the array holds; not a property TypeScript can
 * derive from the element type, so each branch narrows through it once.
 */
export function flatOf(
  objects: readonly (THREE.Matrix4 | THREE.Vector3)[],
  stride: number,
  out: Float64Array,
): Float64Array {
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (stride === 16) copyMatrix4(out, (o as THREE.Matrix4).elements, i * 16);
    else {
      const v = o as THREE.Vector3;
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
    }
  }
  return out;
}

/** Parameters of `duel`, generic on the flat result type both sides produce. */
export interface DuelParams<Sortie extends ArrayLike<number> = Float64Array> {
  name: string;
  fichier: string | string[];
  size?: number;
  three: () => void;
  oracle: () => Sortie;
  core: () => Sortie;
  tolerance?: number;
  motif?: string | null;
  /** The declared exception where sdk-core is allowed to run slower than Three, by how much and why. */
  slower?: { atMost: number; reason: string };
}

/**
 * One row, `three` the perf base's witness and `core` the calculation, each running its operation
 * and nothing else on `size` elements. `oracle` reads Three's result untimed, after one run of
 * `three`; `core` returns the engine's. Without `tolerance`, the two must be equal bit for bit;
 * with it, the largest absolute difference must stay under it and the line counts the values that
 * differ. `motif` names what the comparison leaves out, when it leaves something out.
 *
 * `slower` is for the one case where the two sides do not compute the same thing: `{ atMost, reason }`
 * lets the engine reach `atMost` times Three, on the MEDIAN — the statistic the `vs witness` column
 * prints — and the ceiling and the reason go on the line. It is a declaration, not a waiver: the
 * ceiling still fails the test, and a line without `slower` is gated on its best time and must win.
 */
export async function duel<Sortie extends ArrayLike<number> = Float64Array>({
  name,
  fichier,
  size = N,
  three,
  oracle,
  core,
  tolerance,
  motif,
  slower,
}: DuelParams<Sortie>) {
  let maxAbs = 0;
  const differences = (ref: Sortie, obt: Sortie, chemin: string) => {
    const c = compteur();
    // The strict path refuses a length mismatch; the tolerant path must not let one through.
    if (ref.length !== obt.length) maxAbs = Infinity;
    for (let i = 0; i < ref.length; i++) {
      note(c, ref[i], obt[i], `${chemin}[${i}]`);
      maxAbs = Math.max(maxAbs, Math.abs(ref[i] - obt[i]));
    }
    return c;
  };
  const engine = await mesure<null, Sortie>({
    name,
    fichier,
    cas: [{ name, size, input: null }],
    temoin: three,
    calcul: core,
    attendu: () => {
      three();
      return oracle();
    },
    motif,
    ...(tolerance === undefined ? {} : { differences }),
  });
  const c = engine.resultats[0],
    t = c.temoin;
  if (tolerance !== undefined) c.motif = `largest gap ${maxAbs.toExponential(1)} ; ${c.motif}`;
  if (slower)
    c.motif = [`declared up to ${slower.atMost}× Three.js: ${slower.reason}`, c.motif]
      .filter(Boolean)
      .join(' ; ');
  test(`${name}: same result as Three.js, at least as fast`, () => {
    if (tolerance !== undefined)
      assert.ok(maxAbs <= tolerance, `${name}: largest difference ${maxAbs} above ${tolerance}`);
    else assert.equal(c.correct, true, `${name}: ${c.difference}`);
    assert.ok(t, `${name}: Three.js witness produced no measurement`);
    if (slower) {
      // The median ratio the `vs witness` column prints, read as a quotient so that a witness
      // without a median (`ecartTemoin` null) fails the gate instead of reading as 1.
      assert.ok(c.medianeMs !== null, `${name}: sdk-core produced no median`);
      const ratio = c.medianeMs / t.medianeMs;
      assert.ok(
        ratio <= slower.atMost,
        `${name}: sdk-core median ${ratio.toFixed(2)}× Three.js, above the declared ${slower.atMost}× (${slower.reason})`,
      );
    } else {
      assert.ok(c.minMs !== null, `${name}: sdk-core produced no measurement`);
      assert.ok(
        c.minMs <= t.minMs,
        `${name}: sdk-core best ${c.minMs.toFixed(3)} ms above Three.js ${t.minMs.toFixed(3)} ms`,
      );
    }
  });
  return engine;
}
