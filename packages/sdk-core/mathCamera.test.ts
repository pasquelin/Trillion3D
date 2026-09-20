// Batch 3, mathCamera.ts: perspective projection in REVERSED depth and infinite far plane
// (near → 1, infinity → 0), camera frame (view, view-projection, planes), and allocation:
// buffers of a `CameraFrame` are rewritten, never reallocated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { invertMatrix4 } from './mathMatrix4Inverse.ts';
import { multiplyMatrix4 } from './mathMatrix4.ts';
import { createCameraFrame, perspectiveProjection, updateCameraFrame } from './mathCamera.ts';

const proche = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Normalized depth of a point on optical axis at `distance` from eye. */
function profondeur(p: ArrayLike<number>, distance: number) {
  const z = -distance;
  return (p[10] * z + p[14]) / (p[11] * z + p[15]);
}

test('perspectiveProjection: near plane projects to 1', () => {
  const near = 1;
  const p = perspectiveProjection(new Float64Array(16), 90, 1, near, 1);
  assert.ok(proche(profondeur(p, near), 1), `proche → 1 : ${profondeur(p, near)}`);
});

test('perspectiveProjection: infinite far plane — depth approaches 0 without reaching it', () => {
  const near = 0.5;
  const p = perspectiveProjection(new Float64Array(16), 60, 1.5, near, 1);
  // No far plane enters the formula: depth row only carries `near`.
  assert.deepEqual([p[10], p[14]], [0, near]);
  for (const distance of [1e3, 1e6, 1e12]) {
    const z = profondeur(p, distance);
    assert.ok(z > 0, `distance ${distance}: depth ${z} must remain strictly positive`);
    assert.ok(z < 1, `distance ${distance}: depth ${z} must remain below near plane`);
  }
});

test('perspectiveProjection: at 10⁶ units, two adjacent points retain distinct single-precision depths', () => {
  const near = 0.1;
  const p = perspectiveProjection(new Float64Array(16), 60, 1.5, near, 1);
  // The case direct projection squashed: two surfaces separated by 1m, very far.
  const proche32 = Math.fround(profondeur(p, 1e6));
  const loin32 = Math.fround(profondeur(p, 1e6 + 1));
  assert.notEqual(proche32, loin32, `10⁶ and 10⁶+1 yield the same depth ${proche32}`);
  assert.ok(proche32 > loin32, 'the nearer surface must carry the larger depth');
});

test('perspectiveProjection: relative depth order follows distance order', () => {
  const p = perspectiveProjection(new Float64Array(16), 45, 1, 0.1, 1);
  const distances = [0.1, 0.5, 1, 7.25, 100, 5_000, 1e6];
  const profondeurs = distances.map((d) => profondeur(p, d));
  for (let i = 1; i < profondeurs.length; i++)
    assert.ok(
      profondeurs[i] < profondeurs[i - 1],
      `${distances[i]} must be farther than ${distances[i - 1]}: ` +
        `${profondeurs[i]} contre ${profondeurs[i - 1]}`,
    );
});

test('perspectiveProjection: doubling zoom halves apparent size (terms [0] and [5] double)', () => {
  const base = perspectiveProjection(new Float64Array(16), 50, 16 / 9, 0.1, 1);
  const zoome = perspectiveProjection(new Float64Array(16), 50, 16 / 9, 0.1, 2);
  assert.ok(proche(zoome[0], base[0] * 2));
  assert.ok(proche(zoome[5], base[5] * 2));
});

test('perspectiveProjection: standard perspective last column (0,0,-1,0)', () => {
  const p = perspectiveProjection(new Float64Array(16), 45, 1, 1, 1);
  assert.deepEqual([p[3], p[7], p[11], p[15]], [0, 0, -1, 0]);
});

test('updateCameraFrame: view = inverse of world matrix, viewProjection = projection · view', () => {
  const frame = createCameraFrame();
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 1);
  const world = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1]); // translation pure
  updateCameraFrame(frame, projection, world);
  const vueAttendue = invertMatrix4(new Float64Array(16), world);
  assert.deepEqual([...frame.view], [...vueAttendue]);
  const vpAttendue = multiplyMatrix4(new Float64Array(16), projection, vueAttendue);
  assert.deepEqual([...frame.viewProjection], [...vpAttendue]);
});

test('updateCameraFrame: a singular world matrix yields a zero view, like reference inverse', () => {
  const frame = createCameraFrame();
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 1);
  const singuliere = new Float64Array(16);
  updateCameraFrame(frame, projection, singuliere);
  assert.deepEqual([...frame.view], new Array(16).fill(0));
});

test('allocation: CameraFrame buffers are the same objects across frames', () => {
  const frame = createCameraFrame();
  const vue = frame.view,
    vp = frame.viewProjection,
    plans = frame.planes;
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 1);
  updateCameraFrame(frame, projection, IDENTITY);
  updateCameraFrame(
    frame,
    projection,
    Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]),
  );
  assert.equal(frame.view, vue);
  assert.equal(frame.viewProjection, vp);
  assert.equal(frame.planes, plans);
  assert.equal(updateCameraFrame(frame, projection, IDENTITY), frame, 'renders the same object');
});
