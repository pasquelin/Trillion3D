// A10: `renderWebgpuPages` copies the Hi-Z comparison view (`run.previousHizView`) into the same
// kept engine camera instead of allocating one per view change. `sameHizView` reads only the view
// and the projection, so copying into an already-allocated structure must yield exactly the same
// verdict, image after image, as a fresh structure.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { sameHizView } from '../../../hiz/hiz.ts';
import { invalidateOccluderHistory, invalidateTemporalPyramid } from '../io/drops.ts';
import {
  createEngineCamera,
  holdCameraWorld,
  readCameraWorld,
  type EngineCamera,
} from '../../../camera/world.ts';
import { cameraMoteur } from '../../../camera/camera.fixture.ts';

function poses(n: number) {
  const cams: G.GraphCamera[] = [];
  for (let i = 0; i < n; i++) {
    const cam = G.perspectiveCamera(55, 16 / 9, 0.1, 200);
    cam.position.set(Math.sin(i * 0.7) * 3, 0, 6 + i * 0.001);
    if (i % 5 === 0) cam.fov = 40 + i; // occasional projection change
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cams.push(cam);
  }
  return cams;
}

test('copying a view into a kept engine camera matches a fresh one, verdict for verdict', () => {
  const frames = poses(50);
  let neuve: EngineCamera | undefined;
  let gardee: EngineCamera | undefined;
  for (const frame of frames) {
    const courante = cameraMoteur(frame);
    const viaNeuve = sameHizView(neuve, courante);
    neuve = holdCameraWorld(createEngineCamera(), courante);
    const viaCopie = sameHizView(gardee, courante);
    gardee = holdCameraWorld(gardee ?? createEngineCamera(), courante);
    assert.equal(viaCopie, viaNeuve, 'same-image verdict must not depend on a fresh structure');
  }
});

test('the kept camera is the same object across frames: never reallocated, never left undefined', () => {
  const frames = poses(3);
  let kept: EngineCamera | undefined;
  const identities = new Set<EngineCamera>();
  for (const frame of frames) {
    const courante = cameraMoteur(frame);
    sameHizView(kept, courante);
    kept = holdCameraWorld(kept ?? createEngineCamera(), courante);
    identities.add(kept);
  }
  assert.equal(identities.size, 1, 'the same camera instance is reused across every frame');
});

test('a repeated identical pose is stable, and NaN in the world matrix never reports a false match', () => {
  const a = G.perspectiveCamera(55, 1, 0.1, 100);
  a.position.z = 5;
  a.lookAt(0, 0, 0);
  a.updateMatrixWorld();
  const kept = holdCameraWorld(createEngineCamera(), cameraMoteur(a));
  assert.equal(sameHizView(kept, cameraMoteur(a)), true);
  // The kept camera is frozen; THIS image's is copied from the host, which inverts its world matrix:
  // a NaN must enter through the local pose, not by touching the numbers by hand, or it would be
  // rewritten before the comparison.
  const nanCam = a.clone();
  nanCam.position.x = NaN;
  assert.equal(
    sameHizView(kept, readCameraWorld(createEngineCamera(), nanCam)),
    false,
    'NaN never compares equal to itself',
  );
});

// "Occluder history" lever: a moving camera only voids the temporal pyramid. The two invalidations
// are of different kinds — the pyramid is reread only for a bit-identical view, occluder history
// names pages only — and therefore split.
function runState() {
  return {
    noOccluderHistory: false,
    temporalHizState: { pyramid: {}, camera: {} },
  } as unknown as Parameters<typeof invalidateTemporalPyramid>[0];
}

test('invalidateTemporalPyramid drops the pyramid and keeps the occluder history', () => {
  const run = runState();
  invalidateTemporalPyramid(run);
  assert.equal(run.temporalHizState.pyramid, undefined);
  assert.equal(run.temporalHizState.camera, undefined);
  assert.equal(run.noOccluderHistory, false, 'the pages drawn last image still describe this one');
});

test('invalidateOccluderHistory still drops both', () => {
  const run = runState();
  invalidateOccluderHistory(run);
  assert.equal(run.temporalHizState.pyramid, undefined);
  assert.equal(run.temporalHizState.camera, undefined);
  assert.equal(run.noOccluderHistory, true);
});
