// WHAT THESE TWO PUBLIC APIS EXPECT, AND WHAT THEY REFUSE.
//
// The two APIs are `cameraSelectionUniforms(cam: EngineCamera, …)` (../gpu/core/selection.ts) and
// `rasterVisibility(pages, cam: EngineCamera, viewport)` (bench/oracles/browser/cpu-image/raster.ts)
// — both read `cam.planes`/`cam.view`/`cam.viewProjection`, absent from a raw host camera
// (`G.GraphCamera`).
//
// THE CHOICE: these APIs take the ENGINE camera and reject a raw host camera
// outright. They do not convert at the boundary: converting would put `readCameraWorld` —
// a matrix invert and six planes — back into a function the cut calls every frame, and would
// hide the unwalked rig the contract exists to catch. A host therefore enters through
// `engineCamera(…)`, as frame entry does.
//
// The hosts of `test/*.gpu.ts` enter through `engineCamera` (in-repo fixtures, not third-party
// hosts). They are scripts outside `pnpm test`, that only `pnpm run test:gpu` runs — these tests
// therefore reproduce both calls without a browser, the faulty one and the right one.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { cameraSelectionUniforms } from '../gpu/core/selection.ts'
import type { VisPage } from '../visibility/types.ts'
import {
  POSES_PARENT,
  flattenedCamera,
  creeRig,
  poseRig,
} from '../../../../tests/gpu/kit/cameraRig.ts'
import { engineCamera } from './camera.fixture.ts'
import { surfaceOf } from '../page/surface.ts'
import { identityRoots } from '../page/selection/placements.fixture.ts'
import { rasterVisibility } from '../../../../bench/oracles/browser/cpu-image/raster.ts'

type Pose = (typeof POSES_PARENT)[number]
const POSE = POSES_PARENT[2] as Pose // moved AND rotated: neither translation nor rotation can be guessed.

function pageTriangle(): VisPage {
  const geometry = new G.Geometry()
  geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3))
  return {
    array: new Uint32Array([0, 1, 2]),
    attributes: geometry.attributes,
    material: surfaceOf(G.basicSurface({ side: G.FRONT_SIDE })),
  }
}

test('cameraSelectionUniforms rejects the raw host camera: it does not convert at the boundary', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as G.Camera
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
  )
})

test('rasterVisibility rejects the raw host camera: it does not convert at the boundary', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as G.Camera
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
  )
})

test('cameraSelectionUniforms(engineCamera(…)): the correct call under a rig throws nothing and follows the flattened pose', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as G.Camera,
    flattened = flattenedCamera(POSE) as G.Camera
  const sousRig = cameraSelectionUniforms(engineCamera(camera), 0, [1000, 1000])
  const expected = cameraSelectionUniforms(engineCamera(flattened), 0, [1000, 1000])
  assert.deepEqual([...sousRig.planes], [...expected.planes], 'frustum planes')
  assert.deepEqual([...sousRig.view], [...expected.view], 'view')
  assert.deepEqual(sousRig.cameraWorld, expected.cameraWorld, 'eye world position')
})

test('rasterVisibility(engineCamera(…)): the correct call under a rig throws nothing and yields the same image', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as G.Camera,
    flattened = flattenedCamera(POSE) as G.Camera,
    roots = identityRoots()
  const sousRig = rasterVisibility([pageTriangle()], roots, engineCamera(camera), [64, 64])
  const expected = rasterVisibility([pageTriangle()], roots, engineCamera(flattened), [64, 64])
  assert.deepEqual([...sousRig.ids], [...expected.ids], 'the visibility buffer must be identical')
})
