// WHAT THESE TWO PUBLIC APIS EXPECT, AND WHAT THEY REFUSE.
//
// BEFORE (develop, fe285470): `cameraSelectionUniforms(camera: G.GraphCamera, …)` and
// `rasterVisibility(pages, camera: G.GraphCamera, viewport)`.
// AFTER (M3b): `cameraSelectionUniforms(cam: EngineCamera, …)` (../gpu/core/selection.ts) and
// `rasterVisibility(pages, cam: EngineCamera, viewport)` (../visibility/raster.ts) — both read
// `cam.planes`/`cam.view`/`cam.viewProjection`, absent from a raw host camera.
//
// THE CHOICE, AND IT IS FINAL: these APIs take the ENGINE camera and reject a raw host camera
// outright. They do not convert at the boundary: converting would put `readCameraWorld` —
// a matrix invert and six planes — back into a function the cut calls every frame, and would
// hide the unwalked rig the contract exists to catch. A host therefore enters through
// `engineCamera(…)`, as frame entry does.
//
// `test:gpu` had failed on four hosts of `test/*.gpu.ts` that stayed on the raw camera;
// they moved to `engineCamera` (in-repo fixtures, not third-party hosts). `pnpm test` had not
// seen it: they are scripts outside `pnpm test`, that only `pnpm run test:gpu` runs —
// these tests therefore reproduce both calls without a browser, the faulty one and the right one.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { cameraSelectionUniforms } from '../gpu/core/selection.ts';
import type { VisPage } from '../visibility/types.ts';
import {
  POSES_PARENT,
  flattenedCamera,
  creeRig,
  poseRig,
} from '../../../../tests/gpu/kit/cameraRig.ts';
import { engineCamera } from './camera.fixture.ts';
import { surfaceOf } from '../page/surface.ts';
import { identityRoots } from '../page/selection/placements.fixture.ts';
import { rasterVisibility } from '../../../../bench/oracles/browser/cpu-image/raster.ts';

type Pose = (typeof POSES_PARENT)[number];
const POSE = POSES_PARENT[2] as Pose; // moved AND rotated: neither translation nor rotation can be guessed.

function pageTriangle(): VisPage {
  const geometrie = new G.Geometry();
  geometrie.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
  return {
    array: new Uint32Array([0, 1, 2]),
    attributes: geometrie.attributes,
    material: surfaceOf(G.basicSurface({ side: G.FRONT_SIDE })),
  };
}

test('cameraSelectionUniforms rejects the raw host camera: it does not convert at the boundary', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as G.Camera;
  // `camera` has neither `.planes` nor `.view` nor `.viewProjection`: what `test:gpu` found on
  // a real GPU is already visible here, without GPU or browser.
  assert.throws(
    () =>
      cameraSelectionUniforms(
        camera as unknown as Parameters<typeof cameraSelectionUniforms>[0],
        0,
        [1000, 1000],
      ),
    TypeError,
    'expected: outright reject (TypeError) for lack of `cam.planes` — if this passes: silent wrong uniforms',
  );
});

test('rasterVisibility rejects the raw host camera: it does not convert at the boundary', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as G.Camera;
  assert.throws(
    () =>
      rasterVisibility(
        [pageTriangle()],
        identityRoots(),
        camera as unknown as Parameters<typeof rasterVisibility>[2],
        [64, 64],
      ),
    TypeError,
    'expected: outright reject (TypeError) for lack of `cam.viewProjection` — if this passes: silent wrong buffer',
  );
});

test('cameraSelectionUniforms(engineCamera(…)): the correct call under a rig throws nothing and follows the flattened pose', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as G.Camera,
    aplatie = flattenedCamera(POSE) as G.Camera;
  const sousRig = cameraSelectionUniforms(engineCamera(camera), 0, [1000, 1000]);
  const attendu = cameraSelectionUniforms(engineCamera(aplatie), 0, [1000, 1000]);
  assert.deepEqual([...sousRig.planes], [...attendu.planes], 'frustum planes');
  assert.deepEqual([...sousRig.view], [...attendu.view], 'view');
  assert.deepEqual(sousRig.cameraWorld, attendu.cameraWorld, 'eye world position');
});

test('rasterVisibility(engineCamera(…)): the correct call under a rig throws nothing and yields the same image', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as G.Camera,
    aplatie = flattenedCamera(POSE) as G.Camera,
    roots = identityRoots();
  const sousRig = rasterVisibility([pageTriangle()], roots, engineCamera(camera), [64, 64]);
  const attendu = rasterVisibility([pageTriangle()], roots, engineCamera(aplatie), [64, 64]);
  assert.deepEqual([...sousRig.ids], [...attendu.ids], 'the visibility buffer must be identical');
});
