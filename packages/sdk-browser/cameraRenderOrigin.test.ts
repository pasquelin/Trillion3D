// THE RENDER FRAME, AND WHAT IT MUST BOTH CHANGE AND NOT CHANGE.
//
// A scene far from the world origin jittered: `view · world` was composed in single precision,
// where two numbers of the order of 50 km that almost cancel leave only a few millimetres of
// correct digits, and the cancellation did not fall in the same place from frame to frame. The
// CPU now subtracts the eye position in double precision, before any rounding.
//
// These proofs hold in two sentences. FAR: the same scene, placed at the origin then at 50 km,
// sends exactly the same numbers. AT THE ORIGIN: where the eye is already at world zero, nothing
// changes by a bit — that is what guarantees already-rendered frames keep their pixels.
//
// Coordinates are multiples of 1/8 and the offset is 50 000: their sums are exact in double,
// so the expected equality is that of recentering and not of a lenient rounding.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { multiplyMatrix4, worldToRenderOrigin } from '../sdk-core/src/index.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { sameRenderOrigin } from './cameraRenderOrigin.ts';
import { cameraMoteur } from './cameraFixture.ts';
import { createEngineCamera, holdCameraWorld, readCameraWorld } from './cameraWorld.ts';

const DECALAGE: [number, number, number] = [50000, 50000, 50000];
/** Pose of the primitive, of the eye and of its target, in multiples of 1/8. */
const POSE: [number, number, number] = [3.25, -1.5, 2.125],
  OEIL: [number, number, number] = [-2.75, 1.875, 9.5],
  CIBLE: [number, number, number] = [0.5, -0.25, 0.75];

/** Number-for-number equality. `===` rather than a deep compare: two zeros of opposite
 *  signs are the same number, and nothing in a matrix distinguishes them. */
function memesNombres(obtenu: ArrayLike<number>, attendu: ArrayLike<number>, quoi: string) {
  assert.equal(obtenu.length, attendu.length, `${quoi}: lengths`);
  for (let i = 0; i < attendu.length; i++)
    assert.ok(obtenu[i] === attendu[i], `${quoi}, term ${i}: ${obtenu[i]} ≠ ${attendu[i]}`);
}

/** What a frame sends to the cut kernel for a scene offset by `offset`: the sixteen
 *  single-precision numbers of a world matrix brought back to the eye, and the camera uniforms. */
function envoi(offset: readonly [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 1000);
  camera.position.set(OEIL[0] + offset[0], OEIL[1] + offset[1], OEIL[2] + offset[2]);
  camera.lookAt(CIBLE[0] + offset[0], CIBLE[1] + offset[1], CIBLE[2] + offset[2]);
  camera.updateMatrixWorld(true);
  const cam = cameraMoteur(camera);
  const world = new THREE.Matrix4()
    .makeRotationY(0.7)
    .setPosition(POSE[0] + offset[0], POSE[1] + offset[1], POSE[2] + offset[2]);
  const worlds = new Float32Array(16);
  worldToRenderOrigin(worlds, world.elements, cam.eye);
  return { cam, world, worlds, uniforms: cameraSelectionUniforms(cam, 1, [1280, 720]) };
}

test('same scene at the origin and at 50 km: the sent matrices are identical bit for bit', () => {
  const proche = envoi([0, 0, 0]),
    loin = envoi(DECALAGE);
  memesNombres(loin.worlds, proche.worlds, 'world matrix brought back to the eye');
  memesNombres(loin.uniforms.view, proche.uniforms.view, 'relative view');
  memesNombres(loin.uniforms.planes, proche.uniforms.planes, 'relative planes');
  assert.equal(loin.uniforms.cameraStretch, proche.uniforms.cameraStretch);
});

test('the published frame origin is the eye world position, not a zero', () => {
  const loin = envoi(DECALAGE);
  memesNombres(
    loin.uniforms.cameraWorld,
    [OEIL[0] + DECALAGE[0], OEIL[1] + DECALAGE[1], OEIL[2] + DECALAGE[2]],
    'render-frame origin',
  );
});

test('camera at the world origin: nothing changes by a bit', () => {
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 1000);
  camera.lookAt(CIBLE[0], CIBLE[1], CIBLE[2]);
  camera.updateMatrixWorld(true);
  const cam = cameraMoteur(camera);
  memesNombres(cam.eye, [0, 0, 0], 'the eye is at world zero');
  memesNombres(cam.viewRelative, cam.view, 'the relative view IS the view');
  memesNombres(cam.planesRelative, cam.planes, 'the relative planes ARE the planes');
  const world = new THREE.Matrix4().makeRotationZ(-0.4).setPosition(POSE[0], POSE[1], POSE[2]);
  const ramene = worldToRenderOrigin(new Float64Array(16), world.elements, cam.eye);
  memesNombres(ramene, world.elements, 'the world matrix is returned as-is');
});

test('relative view × relative world yields the absolute composition, where f32 gives up', () => {
  const loin = envoi(DECALAGE);
  const attendu = multiplyMatrix4(
    new Float64Array(16),
    loin.cam.view,
    Float64Array.from(loin.world.elements),
  );
  const relatif = worldToRenderOrigin(new Float64Array(16), loin.world.elements, loin.cam.eye);
  const obtenu = multiplyMatrix4(new Float64Array(16), loin.cam.viewRelative, relatif);
  for (let i = 0; i < 16; i++)
    assert.ok(
      Math.abs(obtenu[i]! - attendu[i]!) <= 1e-9,
      `term ${i}: ${obtenu[i]} ≠ ${attendu[i]} — the composition changed result`,
    );
});

test('a held view keeps its render frame: holdCameraWorld copies it too', () => {
  const source = envoi(DECALAGE).cam,
    gelee = holdCameraWorld(createEngineCamera(), source);
  memesNombres(gelee.viewRelative, source.viewRelative, 'held relative view');
  memesNombres(gelee.viewProjectionRelative, source.viewProjectionRelative, 'view-projection');
  memesNombres(gelee.planesRelative, source.planesRelative, 'held relative planes');
  // The source is rewritten by the next frame: the held copy still describes its own.
  const avant = [...gelee.viewRelative];
  const tournee = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 1000);
  tournee.lookAt(1, 2, 3);
  tournee.updateMatrixWorld(true);
  readCameraWorld(source, tournee);
  assert.notDeepEqual([...source.viewRelative], avant, 'witness: the source has indeed changed');
  memesNombres(gelee.viewRelative, avant, 'the held copy has not moved');
});

test('an origin never set differs from everything: the first frame rebases', () => {
  const jamais = new Float64Array([NaN, NaN, NaN]);
  assert.equal(sameRenderOrigin(jamais, [0, 0, 0]), false);
  assert.equal(sameRenderOrigin(jamais, jamais), false);
  assert.equal(sameRenderOrigin([1, 2, 3], [1, 2, 3]), true);
  assert.equal(sameRenderOrigin([1, 2, 3], [1, 2, 3.0001]), false);
});
