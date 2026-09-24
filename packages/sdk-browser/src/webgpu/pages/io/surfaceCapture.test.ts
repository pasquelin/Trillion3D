// `captureSurfaceView` (lot 3): the published `cameraWorld` is that of the engine camera the
// contract just copied (`rt.run.gate.cam.eye`), never a direct read of the host camera. Under a rig
// the host does not walk, the two poses differ: only the world pose discriminates.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, quadBackend } from '../testScenes.fixture.ts';

test("captureSurfaceView: cameraWorld is the world pose under a rig, not the host camera's local pose", async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const { fixture, backend } = quadBackend(device);
  try {
    await backend.prepare();
    const main = camera();
    backend.render(main);
    await backend.flush?.();
    backend.render(main);
    await backend.flush?.();

    // Two-level rig, which nobody but this test walks: the local camera keeps a trivial pose, and it
    // is the rig alone that carries translation and rotation.
    const rig = new G.GraphNode();
    rig.position.set(4, -2, 6);
    rig.rotation.set(0, Math.PI / 3, 0);
    const view = G.perspectiveCamera(55, 1, 0.1, 100);
    view.position.set(0, 0, 0);
    rig.add(view);
    rig.updateWorldMatrix(true, false);
    const attendu = G.worldPosition(view, new G.Vector3()).toArray();
    // Witness: the camera's local pose (the origin) is not the world pose under this rig.
    assert.notDeepEqual(attendu, G.xyz(view.position));

    const surface = await backend.captureSurfaceView!(view, { width: 16, height: 16 });
    assert.deepEqual(surface.cameraWorld, attendu);
    surface.dispose();
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
