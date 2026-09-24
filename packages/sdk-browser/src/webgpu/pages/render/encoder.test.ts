// `submitColorCopy` (lot 3): the `encoding-submit` trace publishes `pose: enginePose(run.gate.cam)`,
// never again `cameraPose(run.lastCamera)`. Under a rig the host does not walk, only the engine
// camera's world pose discriminates — the host camera's local pose does not move.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, disposeQuadRun, quadBackend } from '../testScenes.fixture.ts';

/** The quad backend on a mock GPU, tracing every diagnostic into `events`. */
function tracedQuad() {
  installGpuGlobals();
  const events: Array<{ phase: string; context: Record<string, unknown> }> = [];
  const { device } = mockGpu();
  const { fixture, backend } = quadBackend(device, {
    diagnosticDetail: 'trace' as never,
    onDiagnostic: (event) => events.push(event),
  });
  return { events, fixture, backend };
}

test("encoding-submit: the traced pose is the engine camera's, not the host camera's local pose", async () => {
  const { events, fixture, backend } = tracedQuad();
  try {
    await backend.prepare();
    // Rig nobody else walks: the local host camera stays at the origin, only the rig carries the
    // translation. The traced pose must follow the rig, not the camera's local pose.
    const rig = new G.GraphNode();
    rig.position.set(7, -1, 4);
    const hostCamera = G.perspectiveCamera(55, 1, 0.1, 100);
    rig.add(hostCamera);
    rig.updateWorldMatrix(true, false);
    const attendu = G.worldPosition(hostCamera, new G.Vector3()).toArray();
    assert.notDeepEqual(attendu, G.xyz(hostCamera.position), 'witness: the rig does move the eye');

    backend.render(hostCamera);
    await backend.flush?.();

    const submissions = events.filter((event) => event.phase === 'encoding-submit');
    assert.ok(submissions.length > 0, 'at least one traced submit');
    for (const event of submissions) {
      const pose = event.context.pose as { position: number[] } | null;
      assert.ok(pose, 'the pose must not be null after a render');
      assert.deepEqual(pose.position, attendu);
    }
  } finally {
    disposeQuadRun(backend, fixture);
  }
});

// Synchronous-triangles lot: the trace publishes `run.drawnTriangles` as-is, without the `pending`
// guard that hid `submittedTriangles` — the value it protected never waited for a GPU readback, so
// it is always a number once an image has been submitted, never `null`.
test('encoding-submit: drawnTriangles publishes run.drawnTriangles, never null once the image is submitted', async () => {
  const { events, fixture, backend } = tracedQuad();
  try {
    await backend.prepare();
    const cam = camera();
    backend.render(cam);
    await backend.flush?.();
    backend.render(cam);

    assert.ok(
      (backend.metrics().drawnTriangles ?? 0) > 0,
      'witness: the camera does see the quad, or 0 would prove nothing',
    );
    const submissions = events.filter((event) => event.phase === 'encoding-submit');
    assert.ok(submissions.length > 0, 'at least one traced submit');
    for (const event of submissions) {
      assert.equal(typeof event.context.drawnTriangles, 'number');
      assert.equal(event.context.drawnTriangles, backend.metrics().drawnTriangles);
    }
  } finally {
    disposeQuadRun(backend, fixture);
  }
});
