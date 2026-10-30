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
import {
  commitOnSubmit,
  commitSubmitted,
  destroyRetired,
  dropSubmitted,
  isSettledEncoder,
  onSettled,
  retire,
} from '../../gpu/core/frameRetire.ts'
import {
  abandonFrameEncoder,
  abandonPart,
  createImagePart,
  openFrameEncoder,
  submitColorCopy,
  submitPart,
  withRenderEncoder,
} from './encoder.ts'
import { installGpuDeviceLedger } from '../../gpu/core/deviceLedger.ts'
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
// was drawn at (`../prepare/timing.ts`).
test('a timed image’s sample carries the render scale it was drawn at', async () => {
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
    for (const { context } of samples) assert.equal(context.renderScale, 1)
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

/** A runtime that holds only what `submitColorCopy` reads for an image of a view drawn beside the main one. */
function submitting(device: GPUDevice) {
  const quiet = { capturing: false }
  const rt = {
    run: { imageRevision: 0, timedSamples: 0, frame: 0, gate: {}, gpuDrawCalls: 0 },
    gpu: { device },
    timing: { frameEncoder: undefined, gpuTiming: undefined, lastQueueSubmitMs: 0 },
    capture: quiet,
    views: { active: {}, main: {} },
    diag: { traceEnabled: false, diagnosticFailure: () => undefined },
    vis: {},
    lights: {},
    bounce: {},
    blendState: {},
    context: {},
  }
  return rt as unknown as Parameters<typeof submitColorCopy>[0]
}

const stubEncoder = () => ({ finish: () => ({}) }) as unknown as GPUCommandEncoder

test('an encoder the queue took commits; one the released session’s queue refused is dropped', () => {
  const ran: string[] = []
  const queue = { submits: 0, submit: () => void queue.submits++ }
  const device = { queue } as unknown as GPUDevice
  const taken = stubEncoder()
  commitOnSubmit(taken, () => ran.push('taken'))
  submitColorCopy(submitting(device), device, taken, 1, 1, true)
  assert.deepEqual(ran, ['taken'])

  // A released session's queue takes nothing and its count stands.
  const released = { submits: 3, submit: () => undefined }
  const gone = { queue: released } as unknown as GPUDevice
  const refused = stubEncoder()
  commitOnSubmit(refused, () => ran.push('refused'))
  submitColorCopy(submitting(gone), gone, refused, 1, 1, true)
  commitSubmitted(refused)
  assert.deepEqual(ran, ['taken'])
})

test('an encoder whose submit throws is dropped, never committed later', () => {
  const ran: string[] = []
  const device = {
    queue: {
      submits: 0,
      submit: () => {
        throw new Error('refused')
      },
    },
  } as unknown as GPUDevice
  const failing = stubEncoder()
  commitOnSubmit(failing, () => ran.push('failing'))
  assert.throws(() => submitColorCopy(submitting(device), device, failing, 1, 1, true), /refused/)
  commitSubmitted(failing)
  assert.deepEqual(ran, [])
})

test('a timed part beside the frame encoder that the queue refused cancels its timer image', () => {
  const gone = { queue: { submits: 3, submit: () => undefined } } as unknown as GPUDevice
  const timed = stubEncoder()
  const plain = stubEncoder()
  let cancelled = 0
  const rt = submitting(gone)
  ;(rt.timing as { gpuTiming?: unknown }).gpuTiming = {
    isSampled: (encoder: GPUCommandEncoder) => encoder === timed,
    cancelUnsubmitted: () => cancelled++,
    markSubmitted: () => undefined,
    hasSubmittedPart: () => false,
    submitted: () => undefined,
  }
  submitColorCopy(rt, gone, plain, 1, 1, true)
  assert.equal(cancelled, 0)
  submitColorCopy(rt, gone, timed, 1, 1, true)
  assert.equal(cancelled, 1)
})

test('an image encoder that throws before its submit is dropped: its releases run, its commits never', () => {
  const ran: string[] = []
  const made = stubEncoder()
  const device = { createCommandEncoder: () => made } as unknown as GPUDevice
  assert.throws(
    () =>
      withRenderEncoder(submitting(device), device, (encoder) => {
        commitOnSubmit(encoder, () => ran.push('commit'))
        onSettled(encoder, () => ran.push('release'))
        throw new Error('encode failed')
      }),
    /encode failed/,
  )
  commitSubmitted(made)
  assert.deepEqual(ran, ['release'])
})

test('a commit that throws after a successful submit counts the image rendered and is reported through diag, not rethrown', () => {
  const device = { queue: { submits: 0, submit: () => void 0 } } as unknown as GPUDevice
  device.queue.submit = () => {
    ;(device.queue as unknown as { submits: number }).submits++
  }
  const rt = submitting(device)
  const failures: Array<[string, unknown]> = []
  ;(rt.diag as { diagnosticFailure: unknown }).diagnosticFailure = (code: string, error: unknown) =>
    failures.push([code, error])
  const encoder = stubEncoder()
  const ran: string[] = []
  commitOnSubmit(encoder, () => {
    throw new Error('commit failed')
  })
  onSettled(encoder, () => ran.push('settled'))
  submitColorCopy(rt, device, encoder, 1, 1, true)
  assert.equal(rt.run.imageRevision, 1)
  assert.deepEqual(ran, ['settled'])
  assert.equal(failures.length, 1)
  assert.equal(failures[0]![0], 'gpu-commit-failed')
  assert.match(String((failures[0]![1] as Error).message), /commit failed/)
})

test('the frame encoder the queue refused or whose submit threw leaves the frame, and its selection settles as not submitted', () => {
  const refusing = { queue: { submits: 3, submit: () => undefined } } as unknown as GPUDevice
  const throwing = {
    queue: {
      submits: 0,
      submit: () => {
        throw new Error('refused')
      },
    },
  } as unknown as GPUDevice
  for (const device of [refusing, throwing]) {
    const frame = stubEncoder()
    const rt = submitting(device)
    const settled: boolean[] = []
    rt.timing.frameEncoder = frame
    rt.timing.frameSelection = (submitted: boolean) => void settled.push(submitted)
    try {
      submitColorCopy(rt, device, frame, 1, 1, true)
    } catch {
      // The throwing queue rethrows its error: the frame is cleaned in the same finally.
    }
    assert.equal(rt.timing.frameEncoder, undefined)
    assert.equal(rt.timing.frameSelection, undefined)
    assert.deepEqual(settled, [false])
  }
})

test('the frame encoder the queue took leaves the frame and its selection settles as submitted', () => {
  const queue = { submits: 0, submit: () => void queue.submits++ }
  const device = { queue } as unknown as GPUDevice
  const rt = submitting(device)
  const frame = stubEncoder()
  const settled: boolean[] = []
  rt.timing.frameEncoder = frame
  rt.timing.frameSelection = (submitted: boolean) => void settled.push(submitted)
  submitColorCopy(rt, device, frame, 1, 1, true)
  assert.equal(rt.timing.frameEncoder, undefined)
  assert.deepEqual(settled, [true])
})

test('a throwing submit of a timed part beside the frame cancels its timer image', () => {
  const device = {
    queue: {
      submits: 0,
      submit: () => {
        throw new Error('refused')
      },
    },
  } as unknown as GPUDevice
  const timed = stubEncoder()
  let cancelled = 0
  const rt = submitting(device)
  ;(rt.timing as { gpuTiming?: unknown }).gpuTiming = {
    isSampled: (encoder: GPUCommandEncoder) => encoder === timed,
    cancelUnsubmitted: () => cancelled++,
    markSubmitted: () => undefined,
    hasSubmittedPart: () => false,
    submitted: () => undefined,
  }
  assert.throws(() => submitColorCopy(rt, device, timed, 1, 1, true), /refused/)
  assert.equal(cancelled, 1)
})

/** No encoder is open on `device`: a resource retired now goes at the next walk. */
function nothingOpen(device: GPUDevice) {
  const probe = { destroyed: false, destroy: () => void (probe.destroyed = true) }
  retire(device, probe)
  destroyRetired(device)
  return probe.destroyed
}

/** A device whose command encoders are stubs, and whose queue takes (`took`) or throws. */
function makerDevice(queue: 'takes' | 'refuses' | 'throws') {
  const submits = { count: 0 }
  return {
    createCommandEncoder: stubEncoder,
    queue: {
      get submits() {
        return submits.count
      },
      submit: () => {
        if (queue === 'throws') throw new Error('refused')
        if (queue === 'takes') submits.count++
      },
    },
  } as unknown as GPUDevice
}

test('a throw at encode leaves no open encoder, whichever path made it', () => {
  // withRenderEncoder, an encoder of its own and the frame's.
  let device = makerDevice('takes')
  assert.throws(
    () =>
      withRenderEncoder(submitting(device), device, () => {
        throw new Error('encode failed')
      }),
    /encode failed/,
  )
  assert.equal(nothingOpen(device), true)
  device = makerDevice('takes')
  let rt = submitting(device)
  openFrameEncoder(rt, device)
  assert.throws(
    () =>
      withRenderEncoder(rt, device, () => {
        throw new Error('encode failed')
      }),
    /encode failed/,
  )
  abandonFrameEncoder(rt)
  assert.equal(nothingOpen(device), true)
  // The frame encoder opened and abandoned.
  device = makerDevice('takes')
  rt = submitting(device)
  openFrameEncoder(rt, device)
  abandonFrameEncoder(rt)
  assert.equal(nothingOpen(device), true)
})

test('an encoder withRenderEncoder made and its encode left unsubmitted is dropped, the frame’s own is left to its owner', () => {
  let device = makerDevice('takes')
  withRenderEncoder(submitting(device), device, () => undefined)
  assert.equal(nothingOpen(device), true)
  device = makerDevice('takes')
  const rt = submitting(device)
  openFrameEncoder(rt, device)
  withRenderEncoder(rt, device, () => undefined)
  assert.equal(nothingOpen(device), false)
  abandonFrameEncoder(rt)
  assert.equal(nothingOpen(device), true)
})

test('a part submitted, refused by the queue or whose submit threw, and a part abandoned, leave no open encoder', () => {
  for (const queue of ['takes', 'refuses', 'throws'] as const) {
    const device = makerDevice(queue)
    const rt = submitting(device)
    const part = createImagePart(rt, device)
    try {
      submitPart(rt, device, part)
    } catch {
      // The throwing queue rethrows its error: the part is settled in the same finally.
    }
    assert.equal(nothingOpen(device), true, queue)
  }
  const device = makerDevice('takes')
  const rt = submitting(device)
  const part = createImagePart(rt, device)
  assert.equal(nothingOpen(device), false)
  abandonPart(rt, part)
  assert.equal(nothingOpen(device), true)
})

test('a part already settled is refused with a diagnostic and submits nothing', () => {
  const device = makerDevice('takes')
  const rt = submitting(device)
  const queue = device.queue as unknown as { submits: number }
  const failures: string[] = []
  ;(rt.diag as { diagnosticFailure: unknown }).diagnosticFailure = (code: string) =>
    failures.push(code)
  const part = createImagePart(rt, device)
  assert.equal(submitPart(rt, device, part), true)
  assert.equal(submitPart(rt, device, part), false)
  assert.deepEqual(failures, ['gpu-settled-submit-failed'])
  assert.equal(queue.submits, 1)
})

test('a throw at encode leaves the frame’s own encoder open for its owner, not dropped by withRenderEncoder', () => {
  const device = makerDevice('takes')
  const rt = submitting(device)
  const frame = openFrameEncoder(rt, device)
  assert.throws(
    () =>
      withRenderEncoder(rt, device, () => {
        throw new Error('encode failed')
      }),
    /encode failed/,
  )
  assert.equal(rt.timing.frameEncoder, frame)
  assert.equal(isSettledEncoder(frame), false)
  abandonFrameEncoder(rt)
  assert.equal(isSettledEncoder(frame), true)
})

test('abandoning the frame encoder settles the selection and cancels the timer whatever a release threw, the first error winning', () => {
  const device = makerDevice('takes')
  const rt = submitting(device)
  const settled: boolean[] = []
  let cancelled = 0
  ;(rt.timing as { gpuTiming: unknown }).gpuTiming = {
    cancelUnsubmitted: () => void cancelled++,
    markSubmitted: () => undefined,
    hasSubmittedPart: () => false,
    isSampled: () => true,
    createEncoder: () => device.createCommandEncoder(),
  }
  const frame = openFrameEncoder(rt, device)
  onSettled(frame, () => {
    throw new Error('first release')
  })
  rt.timing.frameSelection = (submitted: boolean) => void settled.push(submitted)
  assert.throws(() => abandonFrameEncoder(rt), /first release/)
  assert.deepEqual(settled, [false])
  assert.equal(cancelled, 1)
  assert.equal(isSettledEncoder(frame), true)
})

test('a part abandoned cancels its timer image though its release threw, and the release error is thrown', () => {
  const device = makerDevice('takes')
  const rt = submitting(device)
  let cancelled = 0
  const part = createImagePart(rt, device)
  ;(rt.timing as { gpuTiming: unknown }).gpuTiming = {
    cancelUnsubmitted: () => void cancelled++,
    markSubmitted: () => undefined,
    hasSubmittedPart: () => false,
    isSampled: () => true,
  }
  onSettled(part, () => {
    throw new Error('release failed')
  })
  assert.throws(() => abandonPart(rt, part), /release failed/)
  assert.equal(cancelled, 1)
})

test('an encoder made with a label carries it', () => {
  const labels: unknown[] = []
  const device = {
    createCommandEncoder: (descriptor?: GPUObjectDescriptorBase) => {
      labels.push(descriptor?.label)
      return stubEncoder()
    },
  } as unknown as GPUDevice
  const part = createImagePart(submitting(device), device, false, 'Trillion3D roots')
  assert.deepEqual(labels, ['Trillion3D roots'])
  dropSubmitted(part)
})

test('an encoder withRenderEncoder made and left unsubmitted cancels its timer image', () => {
  const device = makerDevice('takes')
  const rt = submitting(device)
  let cancelled = 0
  ;(rt.timing as { gpuTiming: unknown }).gpuTiming = {
    cancelUnsubmitted: () => void cancelled++,
    markSubmitted: () => undefined,
    hasSubmittedPart: () => false,
    isSampled: () => true,
    createEncoder: () => device.createCommandEncoder(),
  }
  withRenderEncoder(rt, device, () => undefined)
  assert.equal(cancelled, 1)
})

test('a readback that throws after the queue took the frame leaves its encoder released and its selection settled as sent', () => {
  const device = makerDevice('takes')
  const rt = submitting(device)
  const settled: boolean[] = []
  const frame = openFrameEncoder(rt, device)
  rt.timing.frameSelection = (submitted: boolean) => void settled.push(submitted)
  ;(rt.lights as { tiles?: unknown }).tiles = {
    submitted: () => {
      throw new Error('readback failed')
    },
  }
  assert.throws(() => submitColorCopy(rt, device, frame, 1, 1, true), /readback failed/)
  assert.equal(rt.timing.frameEncoder, undefined)
  assert.deepEqual(settled, [true])
})

test('a part the queue took marks its timer image; a refused one cancels it only while no part reached the queue', () => {
  let marked = 0
  let cancelled = 0
  let unreached = 0
  let reached = false
  const rt = submitting(makerDevice('takes'))
  const timed = (part: GPUCommandEncoder) => {
    ;(rt.timing as { gpuTiming?: unknown }).gpuTiming = {
      isSampled: (encoder: GPUCommandEncoder) => encoder === part,
      markSubmitted: () => void marked++,
      hasSubmittedPart: () => reached,
      cancelUnsubmitted: () => cancelled++,
      unreachedPart: () => void unreached++,
      submitted: () => undefined,
    }
    return part
  }
  const takes = makerDevice('takes')
  const refuses = makerDevice('refuses')
  assert.equal(submitPart(rt, takes, timed(stubEncoder())), true)
  assert.deepEqual([marked, cancelled], [1, 0])
  assert.equal(submitPart(rt, refuses, timed(stubEncoder())), false)
  assert.deepEqual([marked, cancelled], [1, 1])
  reached = true
  assert.equal(submitPart(rt, refuses, timed(stubEncoder())), false)
  assert.deepEqual(
    [marked, cancelled, unreached],
    [1, 1, 1],
    'the refused part leaves the image the other part reached',
  )
})

test('a device the ledger refused: submitPart says not taken and never throws; the frame submit throws it as before', () => {
  const refusal = new Error('ledger refused')
  const device = Object.assign(makerDevice('takes'), {
    createTexture: () => undefined,
    createBuffer: () => undefined,
  })
  installGpuDeviceLedger(device as never, { base: { refusal } as never })
  let cancelled = 0
  const part = stubEncoder()
  const rt = submitting(device)
  ;(rt.timing as { gpuTiming?: unknown }).gpuTiming = {
    isSampled: () => true,
    markSubmitted: () => undefined,
    hasSubmittedPart: () => false,
    cancelUnsubmitted: () => cancelled++,
    submitted: () => undefined,
  }
  assert.equal(submitPart(rt, device, part), false)
  assert.equal(cancelled, 1)
  assert.throws(() => submitColorCopy(rt, device, stubEncoder(), 1, 1, true), /ledger refused/)
})

test('a throw while the image is presented drops the encoder and the frame’s selection settles as not sent', () => {
  const device = makerDevice('takes')
  const rt = submitting(device)
  const settled: boolean[] = []
  const frame = openFrameEncoder(rt, device)
  rt.timing.frameSelection = (submitted: boolean) => void settled.push(submitted)
  ;(rt.vis as { textures?: unknown }).textures = {
    publishRequests: () => {
      throw new Error('publish failed')
    },
  }
  ;(rt.gpu as { feedbackView?: unknown }).feedbackView = {}
  assert.throws(() => submitColorCopy(rt, device, frame, 1, 1, true), /publish failed/)
  assert.equal(isSettledEncoder(frame), true)
  assert.equal(rt.timing.frameEncoder, undefined)
  assert.deepEqual(settled, [false])
})

test('abandoning the frame encoder after a roots part reached the queue closes the image with it, and cancels it when none did', () => {
  for (const rootsPart of [true, false]) {
    const device = makerDevice('takes')
    const rt = submitting(device)
    const calls: string[] = []
    let reached = false
    let open = false
    ;(rt.timing as { gpuTiming: unknown }).gpuTiming = {
      createEncoder: () => ((open = true), device.createCommandEncoder()),
      isSampled: () => open,
      markSubmitted: () => void (reached = true),
      hasSubmittedPart: () => reached,
      unreachedPart: () => void calls.push('unreached'),
      cancelUnsubmitted: () => void ((open = false), calls.push('cancelled')),
      submitted: () => void calls.push('closed'),
    }
    Object.assign(rt.gpu, { targetSize: [1, 1] })
    Object.assign(rt.run, { gate: { cam: { eye: [0, 0, 0] } } })
    Object.assign(rt.views.active, { scale: { drawn: 1, steered: true } })
    openFrameEncoder(rt, device)
    if (rootsPart) submitPart(rt, device, createImagePart(rt, device))
    abandonFrameEncoder(rt)
    assert.deepEqual(calls, rootsPart ? ['unreached', 'closed'] : ['cancelled'])
  }
})

/** A timer whose calls are listed in `calls`; an encoder is sampled until the image is cancelled or closed. */
function listedTimer(
  rt: ReturnType<typeof submitting>,
  calls: string[],
  made?: () => GPUCommandEncoder,
) {
  let reached = false
  let open = false
  ;(rt.timing as { gpuTiming?: unknown }).gpuTiming = {
    createEncoder: () => ((open = true), made ? made() : stubEncoder()),
    isSampled: () => open,
    markSubmitted: () => void ((reached = true), calls.push('marked')),
    hasSubmittedPart: () => reached,
    unreachedPart: () => void calls.push('unreached'),
    cancelUnsubmitted: () => void ((open = false), calls.push('cancelled')),
    submitted: (_: unknown, metadata: { submission: number }) =>
      void ((open = false), calls.push(`closed:${metadata.submission}`)),
  }
  Object.assign(rt.gpu, { targetSize: [1, 1] })
  Object.assign(rt.run, { gate: { cam: { eye: [0, 0, 0] } } })
  Object.assign(rt.views.active, { scale: { drawn: 1, steered: true } })
}

test('a part the queue took is never let go afterwards: abandoning it, or submitting it again, leaves the timer image as it is', () => {
  const calls: string[] = []
  const device = makerDevice('takes')
  const rt = submitting(device)
  listedTimer(rt, calls)
  // withRenderEncoder abandons whatever its encode left, a part the encode submitted included.
  withRenderEncoder(rt, device, (encoder) => submitColorCopy(rt, device, encoder, 1, 1, true))
  assert.deepEqual(calls, ['marked', 'closed:1'])
  // A part submitted twice: the second answer is a settled refusal, which says nothing of the queue.
  const calls2: string[] = []
  listedTimer(rt, calls2)
  const part = createImagePart(rt, device)
  assert.equal(submitPart(rt, device, part), true)
  assert.equal(submitPart(rt, device, part), false)
  abandonPart(rt, part)
  assert.deepEqual(calls2, ['marked'])
})

test('the timed image closes as soon as the queue took the image, before the readbacks, the inspection and the trace', () => {
  const order: string[] = []
  const device = makerDevice('takes')
  const rt = submitting(device)
  const calls: string[] = []
  listedTimer(rt, calls)
  const timer = (
    rt.timing as { gpuTiming: { submitted: (e: unknown, m: { submission: number }) => void } }
  ).gpuTiming
  const closed = timer.submitted
  timer.submitted = (encoder, metadata) => (order.push('closed'), closed(encoder, metadata))
  ;(rt.lights as { tiles?: unknown }).tiles = { submitted: () => void order.push('readback') }
  ;(rt.run as { inspect?: unknown }).inspect = () => void order.push('inspect')
  Object.assign(rt.views, { main: rt.views.active })
  Object.assign(device.queue, { onSubmittedWorkDone: () => Promise.resolve() })
  Object.assign(rt.run, { gpuFramesInFlight: 0 })
  submitColorCopy(rt, device, createImagePart(rt, device), 1, 1, true)
  assert.deepEqual(order, ['closed', 'readback', 'inspect'])
  assert.deepEqual(calls, ['marked', 'closed:1'], 'the image keeps the revision it takes')
  assert.equal(rt.run.imageRevision, 1)
})

test('what the image retired goes whatever ended the frame submit: a throw, or a release that threw', () => {
  const probe = (device: GPUDevice) => {
    const held = { destroyed: false, destroy: () => void (held.destroyed = true) }
    retire(device, held)
    return held
  }
  const throwing = makerDevice('throws')
  const thrown = probe(throwing)
  assert.throws(
    () => submitColorCopy(submitting(throwing), throwing, stubEncoder(), 1, 1, true),
    /refused/,
  )
  assert.equal(thrown.destroyed, true)

  // The frame's encoder refused by the queue: its release throws, the retirements still go.
  const refusing = makerDevice('refuses')
  const rt = submitting(refusing)
  const frame = openFrameEncoder(rt, refusing)
  onSettled(frame, () => {
    throw new Error('release failed')
  })
  const refused = probe(refusing)
  assert.throws(() => submitColorCopy(rt, refusing, frame, 1, 1, true), /release failed/)
  assert.equal(refused.destroyed, true)
})

test('a timed image whose closing throws still reads back, inspects and counts: each post-submit step runs, the first error is thrown', () => {
  const order: string[] = []
  const device = makerDevice('takes')
  const rt = submitting(device)
  listedTimer(rt, [])
  const timer = (rt.timing as unknown as { gpuTiming: { submitted: () => void } }).gpuTiming
  timer.submitted = () => {
    throw new Error('closing failed')
  }
  ;(rt.lights as { tiles?: unknown }).tiles = { submitted: () => void order.push('readback') }
  ;(rt.run as { inspect?: unknown }).inspect = () => void order.push('inspect')
  Object.assign(rt.views, { main: rt.views.active })
  Object.assign(device.queue, { onSubmittedWorkDone: () => Promise.resolve() })
  Object.assign(rt.run, { gpuFramesInFlight: 0 })
  assert.throws(
    () => submitColorCopy(rt, device, createImagePart(rt, device), 1, 1, true),
    /closing failed/,
  )
  assert.deepEqual(order, ['readback', 'inspect'])
  assert.equal(rt.run.imageRevision, 1)
})

test('an abandoned image takes its own sample number: no two closed samples share one, and the image revision is left as it is', () => {
  const device = makerDevice('takes')
  const rt = submitting(device)
  const calls: string[] = []
  listedTimer(rt, calls)
  rt.run.imageRevision = 4
  openFrameEncoder(rt, device)
  submitPart(rt, device, createImagePart(rt, device))
  abandonFrameEncoder(rt)
  submitColorCopy(rt, device, createImagePart(rt, device), 1, 1, true)
  assert.deepEqual(calls, ['marked', 'unreached', 'closed:1', 'marked', 'closed:2'])
  assert.equal(rt.run.imageRevision, 5)
})

test('a timed part the queue refused closes the image the other parts reached when no frame encoder owns it, and leaves it to the frame encoder otherwise', () => {
  for (const framed of [false, true]) {
    const device = makerDevice('takes')
    const rt = submitting(device)
    const calls: string[] = []
    listedTimer(rt, calls)
    submitPart(rt, device, createImagePart(rt, device))
    const refused = createImagePart(rt, device)
    if (framed) openFrameEncoder(rt, device)
    Object.assign(device.queue, { submit: () => undefined })
    submitColorCopy(rt, device, refused, 1, 1, true)
    assert.deepEqual(calls, framed ? ['marked', 'unreached'] : ['marked', 'unreached', 'closed:1'])
  }
})
