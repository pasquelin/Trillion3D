// A duel between Three.js and sdk-core on one calculation family: same seeded inputs, both sides
// timed on their own operation alone, Three's result — read untimed — the oracle of the engine's.
// Three serves as the witness only, never inside a `math*.ts` file.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { copyMatrix4 } from '../../mathMatrix4.ts';
import { graine, mesure } from '../socle.mjs';
import { compteur, note } from '../socle/ulp.mjs';

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

/** A unit quaternion from four seeded draws. */
export const quaternion = () => new THREE.Quaternion(rnd(), rnd(), rnd(), rnd()).normalize();

/** One view of `stride` numbers per element, built once, outside every chronometer. */
export const views = (flat, stride) =>
  Array.from({ length: flat.length / stride }, (_, i) =>
    flat.subarray(i * stride, i * stride + stride),
  );

/** `n` random translation-rotation-scale matrices: Three objects, one flat buffer, one view each. */
export function trsMatrices(n) {
  const three = [];
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
export function points(n, low = -10, high = 10) {
  const three = [];
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

/** Three's matrices or vectors read flat, `stride` numbers each: the form the engine's result takes. */
export function flatOf(objects, stride, out) {
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (stride === 16) copyMatrix4(out, o.elements, i * 16);
    else {
      out[i * 3] = o.x;
      out[i * 3 + 1] = o.y;
      out[i * 3 + 2] = o.z;
    }
  }
  return out;
}

/**
 * One measure with two lines: `three` timed, then `core` timed, each running its operation and
 * nothing else on `size` elements. `oracle` reads Three's result untimed; `core` returns the
 * engine's. Without `tolerance`, the two must be equal bit for bit; with it, the largest absolute
 * difference must stay under it and the line counts the values that differ. `motif` names what
 * the comparison leaves out, when it leaves something out.
 *
 * `slower` is for the one case where the two sides do not compute the same thing: `{ atMost, reason }`
 * lets the engine's best time reach `atMost` times Three's, and the reason is printed on the line.
 * It is a declaration, not a waiver — the ceiling still fails, and a line without `slower` must win.
 */
export async function duel({
  name,
  fichier,
  size = N,
  three,
  oracle,
  core,
  tolerance,
  motif,
  slower,
}) {
  const cas = [{ name, size, input: null }];
  const witness = await mesure({ name, fichier, cas, calcul: three, motif: 'Three.js witness' });
  let maxAbs = 0;
  const differences = (ref, obt, chemin) => {
    const c = compteur();
    // The strict path refuses a length mismatch; the tolerant path must not let one through.
    if (ref.length !== obt.length) maxAbs = Infinity;
    for (let i = 0; i < ref.length; i++) {
      note(c, ref[i], obt[i], `${chemin}[${i}]`);
      maxAbs = Math.max(maxAbs, Math.abs(ref[i] - obt[i]));
    }
    return c;
  };
  const engine = await mesure({
    name,
    fichier,
    cas,
    calcul: core,
    attendu: oracle,
    motif,
    ...(tolerance === undefined ? {} : { differences }),
  });
  if (tolerance !== undefined)
    engine.resultats[0].motif = `largest gap ${maxAbs.toExponential(1)} ; ${engine.resultats[0].motif}`;
  const t = { ...witness.resultats[0], name: `${name} · Three.js` },
    c = { ...engine.resultats[0], name: `${name} · sdk-core` };
  if (slower) c.motif = `${(c.minMs / t.minMs).toFixed(2)}× Three.js: ${slower.reason}`;
  test(`${name}: same result as Three.js, at least as fast`, () => {
    if (tolerance !== undefined)
      assert.ok(maxAbs <= tolerance, `${name}: largest difference ${maxAbs} above ${tolerance}`);
    else assert.equal(c.correct, true, `${name}: ${c.difference}`);
    const ceiling = slower ? t.minMs * slower.atMost : t.minMs;
    assert.ok(
      c.minMs <= ceiling,
      `${name}: sdk-core best ${c.minMs.toFixed(3)} ms above ${ceiling.toFixed(3)} ms` +
        (slower ? ` (${slower.atMost}× Three.js, ${slower.reason})` : ' of Three.js'),
    );
  });
  return { name, fichier, resultats: [t, c] };
}
