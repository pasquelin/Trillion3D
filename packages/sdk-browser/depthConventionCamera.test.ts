// THE ENGINE DEPTH CONTRACT, checked end to end.
//
// Before this batch, the engine carried TWO conventions: the host camera decided `[−1, 1]` or
// `[0, 1]` and every depth reader converted. It now carries only one: the projection is composed
// by the engine (`perspectiveProjection`), in REVERSED depth and infinite far plane — near at
// 1, infinity at 0 — and `depthConvention.ts` publishes what follows: pipeline comparison,
// the clear value, the sense of "nearer", conversion to distance.
//
// What this file proves: the host clip convention no longer enters any engine number; the
// Hi-Z bound of a box and the depth of a visibility-raster vertex do come out in that
// convention; and a very distant point keeps a depth distinct from its neighbour, where
// the forward projection crushed them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEngineCamera, readCameraWorld } from './cameraWorld.ts';
import {
  DEPTH_CLEAR,
  DEPTH_COMPARE,
  DEPTH_NEAR,
  depthDistance,
  depthNearer,
} from './depthConvention.ts';
import { HIZ_BOUNDS_VALUES, projectCornersInto } from './hizCorners.ts';
import { projectVisibilityVertex } from './visibilityProjection.ts';
import { IDENTITY_ELEMENTS } from './matrixElements.ts';
import { boxCornersInto } from '../sdk-core/index.ts';

const LARGEUR = 800,
  HAUTEUR = 450,
  NEAR = 0.1;

/** A host perspective camera of fixed pose and optics, in a host clip convention. */
function camera(coordinateSystem: THREE.CoordinateSystem) {
  const cam = new THREE.PerspectiveCamera(50, LARGEUR / HAUTEUR, NEAR, 1000);
  cam.position.set(2, 1, 8);
  cam.lookAt(0, 0, 0);
  cam.coordinateSystem = coordinateSystem;
  cam.updateProjectionMatrix();
  return readCameraWorld(createEngineCamera(), cam);
}

const webGL = camera(THREE.WebGLCoordinateSystem);
const webGPU = camera(THREE.WebGPUCoordinateSystem);

/** A world box in front of both cameras, neither behind nor cutting the near plane. */
const CORNERS = new Float64Array(24);
boxCornersInto(CORNERS, 0, -1, -1, -1, 1, 1, 1, IDENTITY_ELEMENTS);

/** Hi-Z bound of an engine camera for that box. */
function borne(cam: ReturnType<typeof camera>) {
  const into = new Float64Array(HIZ_BOUNDS_VALUES);
  projectCornersInto(CORNERS, 0, cam.view, cam.viewProjection, cam.near, LARGEUR, HAUTEUR, into, 0);
  assert.equal(into[5], 0, 'the box must be projected, not rejected');
  return into;
}

test('the host clip convention no longer enters any engine number', () => {
  for (let i = 0; i < 16; i++)
    assert.ok(
      Object.is(webGL.projection[i], webGPU.projection[i]),
      `projection[${i}] : ${webGL.projection[i]} au lieu de ${webGPU.projection[i]}`,
    );
  assert.deepEqual([...borne(webGL)], [...borne(webGPU)], 'same Hi-Z bounds');
});

test('engine depth is reversed: the near plane is 1, the far is 0', () => {
  assert.equal(DEPTH_COMPARE, 'greater');
  assert.equal(DEPTH_NEAR, 1);
  assert.equal(DEPTH_CLEAR, 0);
  assert.equal(depthNearer(DEPTH_NEAR, DEPTH_CLEAR), true);
  assert.equal(depthNearer(DEPTH_CLEAR, DEPTH_NEAR), false);
  assert.equal(depthDistance(NEAR, NEAR), 1);
  assert.equal(depthDistance(1, NEAR), NEAR);
  assert.equal(depthDistance(DEPTH_CLEAR, NEAR), Infinity);
});

test('depth → distance and distance → depth are reciprocal on the projected vertex', () => {
  // A vertex on the camera optical axis: its eye distance is known to the caller.
  const cible: [number, number, number] = [0, 0, 0];
  const position = { getX: () => cible[0], getY: () => cible[1], getZ: () => cible[2] };
  const p = projectVisibilityVertex(
    { elements: IDENTITY_ELEMENTS },
    position,
    0,
    webGL,
    LARGEUR,
    HAUTEUR,
  );
  assert.ok(p, 'the vertex must project');
  assert.ok(p!.z > 0 && p!.z < 1, `depth ${p!.z} outside the engine range`);
  const distance = depthDistance(p!.z, NEAR);
  assert.ok(
    Math.abs(depthDistance(distance, NEAR) - p!.z) < 1e-12,
    'the round-trip conversion must yield the same depth',
  );
});

test('at 10⁶ units, two neighbouring vertices keep distinct depths in single precision', () => {
  const lointain = (distance: number) => {
    const position = { getX: () => 0, getY: () => 0, getZ: () => 8 - distance };
    const p = projectVisibilityVertex(
      { elements: IDENTITY_ELEMENTS },
      position,
      0,
      webGL,
      LARGEUR,
      HAUTEUR,
    );
    assert.ok(p, 'the distant vertex must project');
    return Math.fround(p!.z);
  };
  const proche = lointain(1e6),
    plusLoin = lointain(1e6 + 1);
  assert.notEqual(proche, plusLoin, `10⁶ and 10⁶+1 yield the same depth ${proche}`);
  assert.equal(depthNearer(proche, plusLoin), true);
});
