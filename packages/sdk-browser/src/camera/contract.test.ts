// Boundaries of the camera-pose contract (`world.ts`), not the functions taken one by one.
//
// Three boundaries, and nothing else: what frame entry resolves, what the frame gate infers
// from it to hold or replay, and what a function called alone must do itself. Each test fails
// if the contract is broken: the host rig is moved AND rotated, and never walked by anyone —
// that is the only case where reading a camera's local pose still looks right.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { enginePose, holdCameraWorld, resolveCameraWorld } from './world.ts';
import { cameraSelectionUniforms } from '../gpu/core/selection.ts';
import { resolvePixelError } from '../page/selection/requests.ts';
import { sameHizView } from '../hiz/temporal.ts';
import { createWebglFrameGate } from '../webgl/core/frameGate.ts';
import {
  POSES_PARENT,
  cameraAplatie,
  creeRig,
  poseRig,
} from '../../../../tests/browser/probes/cameraRig.ts';
import { cameraMoteur } from './camera.fixture.ts';
import { createEngineCamera, type CameraMotion } from './world.ts';

type Pose = (typeof POSES_PARENT)[number];
const VIEWPORT: [number, number] = [1280, 720];
/** Moved by +5 in X AND rotated by 0.6 rad: neither translation nor rotation can be guessed. */
const DEPLACE_ET_TOURNE = POSES_PARENT[2] as Pose;

/** A camera under a rig the host does not walk, and its parentless twin of the same world pose. */
function sousRig(pose: Pose) {
  const rig = creeRig();
  return {
    rig,
    camera: poseRig(rig, pose, false),
    aplatie: cameraAplatie(pose),
  };
}

test('contract: the pose resolved under a moved and rotated parent is the world pose', () => {
  const { camera, aplatie } = sousRig(DEPLACE_ET_TOURNE);
  resolveCameraWorld(camera);
  assert.deepEqual(
    [...camera.matrixWorld.elements],
    [...aplatie.matrixWorld.elements],
    'the resolved world matrix must be that of the flattened camera, bit for bit',
  );
  assert.deepEqual(
    [...cameraMoteur(camera).eye],
    [...cameraMoteur(aplatie).eye],
    'the position read by the contract must be that of the eye in the world',
  );
  // The test discriminates: the local pose, for its part, names a point that does not exist in the world.
  assert.notDeepEqual(G.xyz(camera.position), [...cameraMoteur(aplatie).eye]);
});

test('contract: the published pose is the world pose, never the local pose', () => {
  const { camera, aplatie } = sousRig(DEPLACE_ET_TOURNE);
  assert.deepEqual(enginePose(cameraMoteur(camera)), enginePose(cameraMoteur(aplatie)));
  assert.notDeepEqual(enginePose(cameraMoteur(camera)).position, G.xyz(camera.position));
});

test('boundary: the held-frame gate sees a rig move that the host has not walked', () => {
  const gate = createWebglFrameGate();
  const source = new G.GraphNode();
  const rig = creeRig();
  const viewport: [number, number] = [800, 600];
  /** A frame of a Three-rendered engine, reduced to what pose decides there. */
  const image = () => {
    resolveCameraWorld(rig.camera);
    gate.viewChanged(cameraMoteur(rig.camera), viewport, 1);
    gate.readScene(source, []);
    const tenue = gate.held();
    gate.keep(0, 0, [], 0, false);
    return tenue;
  };
  poseRig(rig, POSES_PARENT[0] as Pose, false);
  assert.equal(image(), false, 'the first frame has nothing to hold');
  assert.equal(image(), false, 'a single identical frame still proves nothing');
  assert.equal(image(), true, 'nothing has moved: the previous frame IS this one');
  // The rig moves ALONE: the camera is not touched, its parent is, and no one walks it.
  poseRig(rig, DEPLACE_ET_TOURNE, false);
  assert.equal(image(), false, 'the view has moved: the frame cannot be held');
  assert.equal(image(), false, 'the new view does not yet have a twin frame');
  assert.equal(image(), true, 'still again: the frame becomes holdable once more');
});

test('boundary: the view history freezes the world pose, not the local pose', () => {
  const { rig, camera, aplatie } = sousRig(POSES_PARENT[1] as Pose);
  const gelee = holdCameraWorld(createEngineCamera(), cameraMoteur(resolveCameraWorld(camera)));
  assert.deepEqual([...gelee.world], [...aplatie.matrixWorld.elements]);
  assert.equal(
    sameHizView(cameraMoteur(gelee), cameraMoteur(camera)),
    true,
    'reread at once, the history describes this view',
  );
  poseRig(rig, DEPLACE_ET_TOURNE, false);
  assert.equal(
    sameHizView(cameraMoteur(gelee), cameraMoteur(camera)),
    false,
    'a rig that moves alone invalidates the history: the local pose, for its part, has not changed',
  );
});

/** A uniforms read copied at once: the work buffer is shared between two calls. */
const uniformes = (camera: G.GraphCamera) => {
  const u = cameraSelectionUniforms(cameraMoteur(camera), 1, VIEWPORT);
  return { view: [...u.view], planes: [...u.planes], cameraWorld: [...u.cameraWorld] };
};

test('boundary: a function called alone resolves its own pose', () => {
  for (const pose of POSES_PARENT as Pose[]) {
    const { camera, aplatie } = sousRig(pose);
    assert.deepEqual(
      uniformes(camera),
      uniformes(aplatie),
      'selection uniforms must describe the same camera as the flattened pose',
    );
  }
});

test('boundary: the adaptive threshold called alone measures the eye velocity in the world', () => {
  const contexte = { pixelError: 1, lodAdaptive: true };
  const rig = creeRig(),
    sousRigMotion: CameraMotion = {},
    aplatieMotion: CameraMotion = {};
  for (const pose of POSES_PARENT as Pose[]) {
    // No frame entry here: the rig camera has never been walked by anyone.
    resolvePixelError(
      contexte,
      cameraMoteur(poseRig(rig, pose, false) as G.GraphCamera),
      sousRigMotion,
    );
    resolvePixelError(contexte, cameraMoteur(cameraAplatie(pose) as G.GraphCamera), aplatieMotion);
    assert.deepEqual(
      [...(sousRigMotion.last ?? [])],
      [...(aplatieMotion.last ?? [])],
      'the position kept for velocity must be that of the eye in the world',
    );
  }
  // The test discriminates: without resolve, the velocity would be that of the camera in its rig.
  assert.notDeepEqual([...(sousRigMotion.last ?? [])], G.xyz(rig.camera.position));
});
