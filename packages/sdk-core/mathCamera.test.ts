// Lot M3a, mathCamera.ts : projection perspective (champ, rapport, zoom) dans les deux conventions de
// profondeur WebGL `[-1,1]` et WebGPU `[0,1]`, image de caméra (vue, vue-projection, plans), et
// allocation : les tampons d’une `CameraFrame` sont réécrits, jamais réalloués.
import test from 'node:test';
import assert from 'node:assert/strict';
import { invertMatrix4 } from './mathMatrix4Inverse.ts';
import { multiplyMatrix4 } from './mathMatrix4.ts';
import { createCameraFrame, perspectiveProjection, updateCameraFrame } from './mathCamera.ts';

const proche = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

test('perspectiveProjection : champ de 90°, rapport 1, near=1 — plan proche à z=-1 mappé à -1 (WebGL) ou 0 (WebGPU)', () => {
  const near = 1,
    far = 100;
  const p = perspectiveProjection(new Float64Array(16), 90, 1, near, far, 1, false);
  // Un point (0, 0, -near, 1) projeté doit tomber sur le plan proche de la convention.
  const clipWebgl = [
    p[8] * -near + p[12],
    p[9] * -near + p[13],
    p[10] * -near + p[14],
    p[11] * -near + p[15],
  ];
  assert.ok(
    proche(clipWebgl[2] / clipWebgl[3], -1),
    `WebGL near → -1 : ${clipWebgl[2] / clipWebgl[3]}`,
  );

  const pGpu = perspectiveProjection(new Float64Array(16), 90, 1, near, far, 1, true);
  const clipGpu = [pGpu[10] * -near + pGpu[14], pGpu[11] * -near + pGpu[15]];
  assert.ok(proche(clipGpu[0] / clipGpu[1], 0), `WebGPU near → 0 : ${clipGpu[0] / clipGpu[1]}`);
});

test('perspectiveProjection : le plan lointain se projette sur 1 dans les deux conventions', () => {
  const near = 0.5,
    far = 200;
  for (const depthZeroToOne of [false, true]) {
    const p = perspectiveProjection(new Float64Array(16), 60, 1.5, near, far, 1, depthZeroToOne);
    const w = p[11] * -far + p[15];
    const zClip = p[10] * -far + p[14];
    assert.ok(proche(zClip / w, 1), `far → 1 (depthZeroToOne=${depthZeroToOne}) : ${zClip / w}`);
  }
});

test('perspectiveProjection : doubler le zoom réduit de moitié la taille apparente (termes [0] et [5] doublent)', () => {
  const base = perspectiveProjection(new Float64Array(16), 50, 16 / 9, 0.1, 1000, 1, false);
  const zoome = perspectiveProjection(new Float64Array(16), 50, 16 / 9, 0.1, 1000, 2, false);
  assert.ok(proche(zoome[0], base[0] * 2));
  assert.ok(proche(zoome[5], base[5] * 2));
});

test('perspectiveProjection : dernière colonne perspective standard (0,0,-1,0)', () => {
  const p = perspectiveProjection(new Float64Array(16), 45, 1, 1, 10, 1, false);
  assert.deepEqual([p[3], p[7], p[11], p[15]], [0, 0, -1, 0]);
});

test('updateCameraFrame : vue = inverse de la matrice monde, vue-projection = projection · vue', () => {
  const frame = createCameraFrame();
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 100, 1, false);
  // translation pure, dans un tampon possédé : le socle ne lit qu'un seul type de tampon.
  const world = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1]);
  updateCameraFrame(frame, projection, world, false);
  const vueAttendue = invertMatrix4(new Float64Array(16), world);
  assert.deepEqual([...frame.view], [...vueAttendue]);
  const vpAttendue = multiplyMatrix4(new Float64Array(16), projection, vueAttendue);
  assert.deepEqual([...frame.viewProjection], [...vpAttendue]);
});

test('updateCameraFrame : une matrice monde singulière rend une vue nulle, comme l’inverse de la référence', () => {
  const frame = createCameraFrame();
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 100, 1, false);
  const singuliere = new Float64Array(16);
  updateCameraFrame(frame, projection, singuliere, false);
  assert.deepEqual([...frame.view], new Array(16).fill(0));
});

test('allocation : les tampons d’une CameraFrame sont les mêmes objets d’une image à l’autre', () => {
  const frame = createCameraFrame();
  const vue = frame.view,
    vp = frame.viewProjection,
    plans = frame.planes;
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 100, 1, false);
  updateCameraFrame(frame, projection, IDENTITY, false);
  updateCameraFrame(
    frame,
    projection,
    Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]),
    true,
  );
  assert.equal(frame.view, vue);
  assert.equal(frame.viewProjection, vp);
  assert.equal(frame.planes, plans);
  assert.equal(updateCameraFrame(frame, projection, IDENTITY, false), frame, 'rend le même objet');
});
