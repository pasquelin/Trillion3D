// Boundaries of the camera-pose contract (`world.ts`), not the functions taken one by one.
//
// Three boundaries, and nothing else: what frame entry resolves, what the frame gate infers
// from it to hold or replay, and what a function called alone must do itself. Each test fails
// if the contract is broken: the host rig is moved AND rotated, and never walked by anyone —
// that is the only case where reading a camera's local pose still looks right.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { enginePose, holdCameraWorld, resolveCameraWorld, sameOccluderView } from './world.ts'
import { cameraSelectionUniforms } from '../gpu/core/selection.ts'
import { resolvePixelError } from '../page/selection/requests.ts'
import { createFrameGateCore } from '../frame/gateCore.ts'
import {
  POSES_PARENT,
  flattenedCamera,
  creeRig,
  poseRig,
} from '../../../../tests/gpu/kit/cameraRig.ts'
import { engineCamera } from './camera.fixture.ts'
import { createEngineCamera, type CameraMotion } from './world.ts'

type Pose = (typeof POSES_PARENT)[number]
const VIEWPORT: [number, number] = [1280, 720]
/** Moved by +5 in X AND rotated by 0.6 rad: neither translation nor rotation can be guessed. */
const DEPLACE_ET_TOURNE = POSES_PARENT[2] as Pose

/** A camera under a rig the host does not walk, and its parentless twin of the same world pose. */
function sousRig(pose: Pose) {
  const rig = creeRig()
  return {
    rig,
    camera: poseRig(rig, pose, false),
    flattened: flattenedCamera(pose),
  }
}

test('contract: the pose resolved under a moved and rotated parent is the world pose', () => {
  const { camera, flattened } = sousRig(DEPLACE_ET_TOURNE)
  resolveCameraWorld(camera)
  assert.deepEqual(
    [...camera.matrixWorld.elements],
    [...flattened.matrixWorld.elements],
    'the resolved world matrix must be that of the flattened camera, bit for bit',
  )
  assert.deepEqual(
    [...engineCamera(camera).eye],
    [...engineCamera(flattened).eye],
    'the position read by the contract must be that of the eye in the world',
  )
  // The test discriminates: the local pose, for its part, names a point that does not exist in the world.
  assert.notDeepEqual(G.xyz(camera.position), [...engineCamera(flattened).eye])
})

/** Root, parent, node, child of the engine's own graph; the parent and the node moved, unwalked. */
function unwalkedChain() {
  const chain = [0, 1, 2, 3].map(() => new Object3D())
  chain.reduce((above, node) => (above.add(node), node))
  chain[0].updateMatrixWorld()
  chain[1].position.set(5, 0, 0)
  chain[1].rotation.y = 0.6
  chain[2].position.set(0, 2, 0)
  chain[3].position.set(1, 0, 0)
  return chain
}

test("contract: a scene node resolved by the contract holds its own update's bits, children left", () => {
  const [read, twin] = [unwalkedChain(), unwalkedChain()]
  assert.equal(resolveCameraWorld(read[2]), read[2], 'the node itself comes back, to read on')
  twin[2].updateWorldMatrix(true, false)
  const state = (chain: Object3D[]) => chain.map((n) => [n._worldVersion, ...n.worldMatrix])
  assert.deepEqual(state(read), state(twin), 'same bits, same nodes recomputed, bit for bit')
  // The test discriminates: the parent's unwalked move is seen, the child is not walked.
  assert.deepEqual([...read[2].worldMatrix.slice(12, 15)], [5, 2, 0])
  assert.deepEqual([...read[3].worldMatrix.slice(12, 15)], [0, 0, 0])
})

test('contract: the published pose is the world pose, never the local pose', () => {
  const { camera, flattened } = sousRig(DEPLACE_ET_TOURNE)
  assert.deepEqual(enginePose(engineCamera(camera)), enginePose(engineCamera(flattened)))
  assert.notDeepEqual(enginePose(engineCamera(camera)).position, G.xyz(camera.position))
})

test('boundary: the held-frame gate sees a rig move that the host has not walked', () => {
  const gate = createFrameGateCore(1)
  const source = new G.Object3D()
  const rig = creeRig()
  const viewport: [number, number] = [800, 600]
  /** A frame of a host-library-rendered engine, reduced to what pose decides there. */
  const image = () => {
    resolveCameraWorld(rig.camera)
    gate.viewChanged(engineCamera(rig.camera), viewport, 1)
    gate.readScene(source, [])
    const held = gate.held()
    gate.hold.keep(gate.revisions)
    return held
  }
  poseRig(rig, POSES_PARENT[0] as Pose, false)
  assert.equal(image(), false, 'the first frame has nothing to hold')
  assert.equal(image(), false, 'a single identical frame still proves nothing')
  assert.equal(image(), true, 'nothing has moved: the previous frame IS this one')
  // The rig moves ALONE: the camera is not touched, its parent is, and no one walks it.
  poseRig(rig, DEPLACE_ET_TOURNE, false)
  assert.equal(image(), false, 'the view has moved: the frame cannot be held')
  assert.equal(image(), false, 'the new view does not yet have a twin frame')
  assert.equal(image(), true, 'still again: the frame becomes holdable once more')
})

test('boundary: the view history freezes the world pose, not the local pose', () => {
  const { rig, camera, flattened } = sousRig(POSES_PARENT[1] as Pose)
  const gelee = holdCameraWorld(createEngineCamera(), engineCamera(resolveCameraWorld(camera)))
  assert.deepEqual([...gelee.world], [...flattened.matrixWorld.elements])
  assert.equal(
    sameOccluderView(engineCamera(gelee), engineCamera(camera)),
    true,
    'reread at once, the history describes this view',
  )
  poseRig(rig, DEPLACE_ET_TOURNE, false)
  assert.equal(
    sameOccluderView(engineCamera(gelee), engineCamera(camera)),
    false,
    'a rig that moves alone invalidates the history: the local pose, for its part, has not changed',
  )
})

/** A uniforms read copied at once: the work buffer is shared between two calls. */
const uniformes = (camera: G.Camera) => {
  const u = cameraSelectionUniforms(engineCamera(camera), 1, VIEWPORT)
  return { view: [...u.view], planes: [...u.planes], cameraWorld: [...u.cameraWorld] }
}

test('boundary: a function called alone resolves its own pose', () => {
  for (const pose of POSES_PARENT as Pose[]) {
    const { camera, flattened } = sousRig(pose)
    assert.deepEqual(
      uniformes(camera),
      uniformes(flattened),
      'selection uniforms must describe the same camera as the flattened pose',
    )
  }
})

test('boundary: the adaptive threshold called alone measures the eye velocity in the world', () => {
  const contexte = { pixelError: 1, lodAdaptive: true }
  const rig = creeRig(),
    sousRigMotion: CameraMotion = {},
    flattenedMotion: CameraMotion = {}
  for (const pose of POSES_PARENT as Pose[]) {
    // No frame entry here: the rig camera has never been walked by anyone.
    resolvePixelError(contexte, engineCamera(poseRig(rig, pose, false) as G.Camera), sousRigMotion)
    resolvePixelError(contexte, engineCamera(flattenedCamera(pose) as G.Camera), flattenedMotion)
    assert.deepEqual(
      [...(sousRigMotion.last ?? [])],
      [...(flattenedMotion.last ?? [])],
      'the position kept for velocity must be that of the eye in the world',
    )
  }
  // The test discriminates: without resolve, the velocity would be that of the camera in its rig.
  assert.notDeepEqual([...(sousRigMotion.last ?? [])], G.xyz(rig.camera.position))
})
