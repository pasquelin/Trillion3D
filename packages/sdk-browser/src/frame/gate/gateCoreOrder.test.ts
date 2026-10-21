// `gateCore.ts` guarantees an ORDER: `enterFrame` copies the camera pose (`readCameraWorld`)
// BEFORE the view fingerprint. `../../camera/contract.test.ts` proves it by calling
// `resolveCameraWorld` then `viewChanged`/`readScene` by hand — never `enterFrame` itself. This
// test loops on the full public entry, so the order is the one `enterFrame` actually applies, not
// the one a test recomposes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createFrameGateCore } from './gateCore.ts'
import { POSES_PARENT, creeRig, poseRig } from '../../../../../tests/kit/device/cameraRig.ts'

type Pose = (typeof POSES_PARENT)[number]
const VIEWPORT: [number, number] = [800, 600]
const DEPLACE_ET_TOURNE = POSES_PARENT[2] as Pose

test('enterFrame copies the pose before the view fingerprint: a rig moved alone, never walked by the host, replays the frame', () => {
  const gate = createFrameGateCore(1)
  const source = new Object3D()
  const rig = creeRig()
  const image = () => {
    // `host = false`: nobody walks the rig, as the contract announces for a parent outside the
    // prepared scene. If `enterFrame` read the local pose, or resolved it AFTER the view
    // fingerprint, this move would change nothing there and the frame would stay held wrongly.
    const held = gate.enterFrame({}, rig.camera, VIEWPORT, source, [])
    gate.hold.keep(gate.revisions)
    return held
  }
  poseRig(rig, POSES_PARENT[0] as Pose, false)
  assert.equal(image(), false, 'the first frame has nothing to hold')
  assert.equal(image(), false, 'a single identical frame still proves nothing')
  assert.equal(image(), true, 'nothing moved: the previous frame IS this one')
  poseRig(rig, DEPLACE_ET_TOURNE, false)
  assert.equal(image(), false, 'the rig moved alone: the frame cannot be held')
  assert.equal(image(), false, 'the new view has no twin frame yet')
  assert.equal(image(), true, 'still again: the frame becomes holdable')
})
