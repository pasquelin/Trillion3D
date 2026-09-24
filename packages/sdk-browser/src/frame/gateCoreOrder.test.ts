// `gateCore.ts` guarantees an ORDER: `enterFrame` copies the camera pose (`readCameraWorld`)
// BEFORE the adaptive threshold and BEFORE the view fingerprint. `../camera/contract.test.ts` proves it
// by calling `resolveCameraWorld` then `viewChanged`/`readScene` by hand — never `enterFrame`
// itself. These tests loop on the full public entry, so the order is the one `enterFrame` actually
// applies, not the one a test recomposes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { createFrameGateCore } from './gateCore.ts';
import { createWebglFrameGate } from '../webgl/core/frameGate.ts';
import type { CameraMotion } from '../camera/world.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import {
  POSES_PARENT,
  cameraAplatie,
  creeRig,
  poseRig,
} from '../../../../tests/browser/probes/cameraRig.ts';

type Pose = (typeof POSES_PARENT)[number];
const VIEWPORT: [number, number] = [800, 600];
const DEPLACE_ET_TOURNE = POSES_PARENT[2] as Pose;

test('enterFrame copies the pose before the view fingerprint: a rig moved alone, never walked by the host, replays the frame', () => {
  const gate = createWebglFrameGate();
  const source = new G.GraphNode();
  const rig = creeRig();
  const motion: CameraMotion = {};
  const image = () => {
    // `hote = false`: nobody walks the rig, as the contract announces for a parent outside the
    // prepared scene. If `enterFrame` read the local pose, or resolved it AFTER the view
    // fingerprint, this move would change nothing there and the frame would stay held wrongly.
    const held = gate.enterFrame({}, rig.camera, motion, VIEWPORT, source, []);
    gate.keep(0, 0, [], 0, false);
    return held;
  };
  poseRig(rig, POSES_PARENT[0] as Pose, false);
  assert.equal(image(), false, 'the first frame has nothing to hold');
  assert.equal(image(), false, 'a single identical frame still proves nothing');
  assert.equal(image(), true, 'nothing moved: the previous frame IS this one');
  poseRig(rig, DEPLACE_ET_TOURNE, false);
  assert.equal(image(), false, 'the rig moved alone: the frame cannot be held');
  assert.equal(image(), false, 'the new view has no twin frame yet');
  assert.equal(image(), true, 'still again: the frame becomes holdable');
});

test('enterFrame resolves the pose before the adaptive threshold: the measured speed is that of the world eye', () => {
  const gate = createFrameGateCore(1);
  const source = new G.GraphNode();
  const rig = creeRig();
  const motion: CameraMotion = {};
  poseRig(rig, DEPLACE_ET_TOURNE, false); // never walked: only `enterFrame` can see it.
  gate.enterFrame({ pixelError: 1, lodAdaptive: true }, rig.camera, motion, VIEWPORT, source, []);
  const eyeAplatie = [...cameraMoteur(cameraAplatie(DEPLACE_ET_TOURNE)).eye];
  assert.deepEqual(
    [...(motion.last ?? [])],
    eyeAplatie,
    'speed must start from the eye position in the world, ancestors included',
  );
  assert.notDeepEqual(
    [...(motion.last ?? [])],
    G.xyz(rig.camera.position),
    'witness: without prior resolution, this would be the local pose under the rig',
  );
});
