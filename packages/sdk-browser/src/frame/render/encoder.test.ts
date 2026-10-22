// `submitColorCopy` (lot 3): the `encoding-submit` trace publishes `pose: enginePose(run.gate.cam)`,
// never again `cameraPose(run.lastCamera)`. Under a rig the host does not walk, only the engine
// camera's world pose discriminates — the host camera's local pose does not move.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { camera, disposeQuadRun, quadBackend } from '../backend/testScenes.fixture.ts'

/** The quad backend on a mock GPU, tracing every diagnostic into `events`. */
function tracedQuad() {
  installGpuGlobals()
  const events: Array<{ phase: string; context: Record<string, unknown> }> = []
  const { device } = fakeDevice(BACKEND)
  const { fixture, backend } = quadBackend(device, {
    diagnosticDetail: 'trace' as never,
    onDiagnostic: (event) => events.push(event),
  })
  return { events, fixture, backend }
}

test("encoding-submit: the traced pose is the engine camera's, not the host camera's local pose", async () => {
  const { events, fixture, backend } = tracedQuad()
  try {
    await backend.prepare()
    // Rig nobody else walks: the local host camera stays at the origin, only the rig carries the
    // translation. The traced pose must follow the rig, not the camera's local pose.
    const rig = new Object3D()
    rig.position.set(7, -1, 4)
    const hostCamera = G.perspectiveCamera(55, 1, 0.1, 100)
    rig.add(hostCamera)
    rig.updateWorldMatrix(true, false)
    const attendu = G.worldPosition(hostCamera, new Vector3()).toArray()
    assert.notDeepEqual(attendu, G.xyz(hostCamera.position), 'witness: the rig does move the eye')

    backend.render(hostCamera)
    await backend.flush()

    const submissions = events.filter((event) => event.phase === 'encoding-submit')
    assert.ok(submissions.length > 0, 'at least one traced submit')
    for (const event of submissions) {
      const pose = event.context.pose as { position: number[] } | null
      assert.ok(pose, 'the pose must not be null after a render')
      assert.deepEqual(pose.position, attendu)
    }
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

// The trace publishes the triangles drawn as the metrics do (the cut's selected), without the
// `pending` guard that hid `submittedTriangles`: a number once an image has been submitted, never
// `null`.
test("encoding-submit: drawnTriangles is the metrics' count, never null once the image is submitted", async () => {
  const { events, fixture, backend } = tracedQuad()
  try {
    await backend.prepare()
    const cam = camera()
    const submissions = () => events.filter((event) => event.phase === 'encoding-submit')
    /** An image drawn: its submit traces the count the run held as it went out — 0 before the GPU
     *  cut's first readback lands (#1483), its count after —, never null. An image that waits for
     *  its root cover submits no draw and traces none. Returns the submits it traced. The count is
     *  read as the image leaves; the trace channel hands its events over one microtask later
     *  (`../io/diagnostics.ts`), so they are read once it has. */
    const image = async () => {
      const before = submissions().length
      backend.render(cam)
      const held = backend.metrics().drawnTriangles
      await Promise.resolve()
      const traced = submissions().slice(before)
      for (const { context } of traced) {
        assert.equal(typeof context.drawnTriangles, 'number')
        assert.equal(context.drawnTriangles, held)
      }
      return traced.length
    }
    let traced = await image()
    await backend.flush()
    traced += await image()
    assert.ok(traced > 0, 'an image traced its submit')

    assert.ok(
      (backend.metrics().drawnTriangles ?? 0) > 0,
      'witness: the camera does see the quad, or 0 would prove nothing',
    )
    for (const event of submissions()) assert.equal(typeof event.context.drawnTriangles, 'number')
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

// The timer's sample carries what the controller pairs the image's time with: the render scale it
// was drawn at and the fraction of the cut's screen error it was cut at (`../prepare/timing.ts`).
test('a timed image’s sample carries the render scale and the edge fraction it was made at', async () => {
  installGpuGlobals()
  const events: Array<{ phase: string; context: Record<string, unknown> }> = []
  const { device } = fakeDevice({ ...BACKEND, features: ['timestamp-query'] })
  const { fixture, backend } = quadBackend(device, {
    diagnosticDetail: 'trace' as never,
    onDiagnostic: (event) => events.push(event),
  })
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    // The sample's readback lands a few tasks later.
    for (let wait = 0; wait < 5; wait++) await new Promise((done) => setTimeout(done, 5))
    const samples = events.filter((event) => event.phase === 'gpu-timing')
    assert.ok(samples.length > 0, 'an image was timed')
    for (const { context } of samples)
      assert.deepEqual([context.renderScale, context.edgeScale], [1, 1])
  } finally {
    disposeQuadRun(backend, fixture)
  }
})
