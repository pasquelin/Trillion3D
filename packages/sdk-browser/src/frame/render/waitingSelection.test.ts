// A frame the initial load draws before the root cover is resident sends the cut's selection alone (`dispatchWaitingSelection`):
// it is an image like any other for the GPU timer, which measures it, as it measures every image drawn.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuTiming } from '../../gpu/timing/timing.ts'
import { timedDevice } from '../../gpu/timing/imageTimer.fixture.ts'
import type { GpuTimingSample } from '../../gpu/timing/types.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { commitOnSubmit, destroyRetired, onSettled, retire } from '../../gpu/core/frameRetire.ts'
import { dispatchWaitingSelection } from './gpuCutStream.ts'
import { createImagePart, submitPart } from './encoder.ts'

test('the selection a frame waiting for its root cover sends is timed as an image: one sample for each frame', async () => {
  const f = timedDevice(),
    samples: GpuTimingSample[] = []
  const gpuTiming = createGpuTiming(f.device, {
    sampleEveryFrames: 1,
    onSample: (sample) => void samples.push(sample),
  })
  const view = { scale: { drawn: 1, steered: true } }
  const rt = {
    run: {
      frame: 0,
      imageRevision: 0,
      timedSamples: 0,
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendSubmittedTriangles: 0,
      lastCamera: null,
      selectionUniforms: {},
      gate: { cam: { eye: [0, 0, 0] } },
      gpuSelection: {
        // The cut: a pass into the encoder it is given, settled once its commands are submitted.
        dispatch(_uniforms: unknown, encoder: GPUCommandEncoder) {
          encoder.beginComputePass({ label: 'cut' }).end()
          return () => undefined
        },
      },
    },
    gpu: { device: f.device, targetSize: [8, 4] },
    timing: { gpuTiming },
    capture: { capturing: false },
    views: { active: view, main: view },
  } as unknown as WebgpuPagesRuntime
  for (let frame = 0; frame < 3; frame++) {
    rt.run.frame = frame
    assert.equal(dispatchWaitingSelection(rt), true)
    // Its readback lands, as the device's would.
    const copy = f.copies.at(-1)?.to
    if (copy)
      new BigUint64Array(copy.getMappedRange()).set([
        BigInt(10 + frame) * 1_000_000n,
        BigInt(11 + frame) * 1_000_000n,
      ])
    await gpuTiming.flush()
  }
  const stats = gpuTiming.stats()
  assert.equal(stats.sampledFrames, 3, 'each frame opened a sample')
  assert.equal(stats.completedSamples, 3, 'and read it back')
  assert.equal(stats.skippedFrames.interval + stats.skippedFrames.busy, 0)
  assert.deepEqual(
    samples.map((sample) => sample.frame),
    [0, 1, 2],
  )
  gpuTiming.dispose()
})

/** A runtime whose cut runs `dispatch`, on a device whose encoders finish into `finish`. */
function waiting(
  dispatch: (encoder: GPUCommandEncoder) => ((submitted: boolean) => void) | undefined,
  finish: () => object,
) {
  const device = {
    createCommandEncoder: () => ({ finish }),
    queue: {
      submits: 0,
      submit() {
        this.submits++
      },
    },
  } as unknown as GPUDevice
  const failures: string[] = []
  const view = { scale: { drawn: 1, steered: true } }
  const rt = {
    run: {
      selectionUniforms: {},
      gpuSelection: { dispatch: (_: unknown, encoder: GPUCommandEncoder) => dispatch(encoder) },
    },
    gpu: { device, targetSize: [8, 4] },
    timing: { gpuTiming: undefined },
    capture: { capturing: false },
    views: { active: view, main: view },
    diag: { diagnosticFailure: (code: string) => void failures.push(code) },
  } as unknown as WebgpuPagesRuntime
  return { rt, device, failures }
}

test('a cut with nothing to send drops its encoder: what was retired while it was open is freed at the next submit', () => {
  const held = { destroyed: false, destroy: () => void (held.destroyed = true) }
  const f = waiting(
    () => {
      retire(f.device, held)
      return undefined
    },
    () => ({}),
  )
  const { device } = f
  assert.equal(dispatchWaitingSelection(f.rt), true)
  destroyRetired(device)
  assert.equal(held.destroyed, true)
})

test('a send whose command buffer cannot be made settles its selection as not sent and drops the encoder', () => {
  const settled: boolean[] = []
  const held = { destroyed: false, destroy: () => void (held.destroyed = true) }
  const f = waiting(
    () => {
      retire(f.device, held)
      return (submitted: boolean) => void settled.push(submitted)
    },
    () => {
      throw new Error('finish failed')
    },
  )
  const { device } = f
  assert.equal(dispatchWaitingSelection(f.rt), false)
  assert.deepEqual(f.failures, ['gpu-selection-dispatch-failed'])
  assert.deepEqual(settled, [false])
  destroyRetired(device)
  assert.equal(held.destroyed, true)
})

test('a send the queue took frees what was retired meanwhile at once, and a commit that throws is reported while the send stands', () => {
  const settled: boolean[] = []
  const held = { destroyed: false, destroy: () => void (held.destroyed = true) }
  const f = waiting(
    (encoder) => {
      retire(f.device, held)
      commitOnSubmit(encoder, () => {
        throw new Error('commit failed')
      })
      return (submitted: boolean) => void settled.push(submitted)
    },
    () => ({}),
  )
  assert.equal(dispatchWaitingSelection(f.rt), true)
  assert.equal(held.destroyed, true)
  assert.deepEqual(f.failures, ['gpu-commit-failed'])
  assert.deepEqual(settled, [true])
})

test('a release that throws when a cut has nothing to send is reported beside the send, which is not a failed one', () => {
  const f = waiting(
    (encoder) => {
      onSettled(encoder, () => {
        throw new Error('release failed')
      })
      return undefined
    },
    () => ({}),
  )
  assert.equal(dispatchWaitingSelection(f.rt), true)
  assert.deepEqual(f.failures, ['gpu-selection-release-failed'])
})

test('a send whose submit threw is settled by the submit alone: its timer image is cancelled once, not abandoned again', () => {
  const settled: boolean[] = []
  let releases = 0
  const f = waiting(
    (encoder) => {
      onSettled(encoder, () => void releases++)
      return (submitted: boolean) => void settled.push(submitted)
    },
    () => ({}),
  )
  ;(f.device.queue as unknown as { submit: () => void }).submit = () => {
    throw new Error('refused')
  }
  const cancels: string[] = []
  ;(f.rt.timing as { gpuTiming: unknown }).gpuTiming = {
    isSampled: () => true,
    markSubmitted: () => undefined,
    hasSubmittedPart: () => false,
    cancelUnsubmitted: () => void cancels.push('cancel'),
    cancelUnused: () => undefined,
    createEncoder: () => f.device.createCommandEncoder(),
    submitted: () => undefined,
  }
  assert.equal(dispatchWaitingSelection(f.rt), false)
  assert.deepEqual(f.failures, ['gpu-selection-dispatch-failed'])
  assert.deepEqual(settled, [false])
  assert.equal(releases, 1)
  assert.deepEqual(cancels, ['cancel'])
})

test('a cut with nothing to send closes the timer image when the roots part reached the queue, and cancels it as unused when no part did', () => {
  for (const rootsPart of [true, false]) {
    const calls: string[] = []
    let reached = false
    const f = waiting(
      () => {
        if (rootsPart) submitPart(f.rt, f.device, createImagePart(f.rt, f.device))
        return undefined
      },
      () => ({}),
    )
    Object.assign(f.rt.run, {
      imageRevision: 0,
      timedSamples: 0,
      frame: 0,
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendSubmittedTriangles: 0,
      lastCamera: null,
      gate: { cam: { eye: [0, 0, 0] } },
    })
    ;(f.rt.timing as { gpuTiming?: unknown }).gpuTiming = {
      createEncoder: (_frame: number, label?: string) => f.device.createCommandEncoder({ label }),
      isSampled: () => true,
      markSubmitted: () => void (reached = true),
      hasSubmittedPart: () => reached,
      submitted: () => void calls.push('closed'),
      cancelUnsubmitted: () => void calls.push('cancelled'),
      cancelUnused: () => void calls.push('unused'),
    }
    assert.equal(dispatchWaitingSelection(f.rt), true)
    assert.deepEqual(calls, [rootsPart ? 'closed' : 'unused'])
  }
})

test('a selection send the queue did not take closes the image the roots part reached and says it did not run, without a failure reported', () => {
  for (const rootsPart of [true, false]) {
    const calls: string[] = []
    let reached = false
    // The timer image is open until cancelled, as the real one.
    let open = false
    const settled: boolean[] = []
    const f = waiting(
      () => {
        if (rootsPart) submitPart(f.rt, f.device, createImagePart(f.rt, f.device))
        // From here the queue takes nothing.
        ;(f.device.queue as unknown as { submit: () => void }).submit = () => undefined
        return (submitted: boolean) => void settled.push(submitted)
      },
      () => ({}),
    )
    Object.assign(f.rt.run, {
      imageRevision: 0,
      timedSamples: 0,
      frame: 0,
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendSubmittedTriangles: 0,
      lastCamera: null,
      gate: { cam: { eye: [0, 0, 0] } },
    })
    ;(f.rt.timing as { gpuTiming?: unknown }).gpuTiming = {
      createEncoder: (_frame: number, label?: string) => (
        (open = true),
        f.device.createCommandEncoder({ label })
      ),
      isSampled: () => open,
      markSubmitted: () => void (reached = true),
      hasSubmittedPart: () => reached,
      submitted: () => void calls.push('closed'),
      cancelUnsubmitted: () => void ((open = false), calls.push('cancelled')),
      unreachedPart: () => void calls.push('unreached'),
      cancelUnused: () => undefined,
    }
    assert.equal(dispatchWaitingSelection(f.rt), false)
    assert.deepEqual(settled, [false])
    assert.deepEqual(calls, rootsPart ? ['unreached', 'closed'] : ['cancelled'])
    assert.deepEqual(f.failures, [])
  }
})

test('a cut that throws after the roots part reached the queue lets go of the cut part and closes the image with the roots', () => {
  const calls: string[] = []
  let reached = false
  let open = false
  const f = waiting(
    () => {
      submitPart(f.rt, f.device, createImagePart(f.rt, f.device))
      throw new Error('cut failed')
    },
    () => ({}),
  )
  Object.assign(f.rt.run, {
    imageRevision: 0,
    timedSamples: 0,
    frame: 0,
    gpuDrawCalls: 0,
    blendDrawCalls: 0,
  })
  Object.assign(f.rt.run, {
    blendSubmittedTriangles: 0,
    lastCamera: null,
    gate: { cam: { eye: [0, 0, 0] } },
  })
  ;(f.rt.timing as { gpuTiming?: unknown }).gpuTiming = {
    createEncoder: () => ((open = true), f.device.createCommandEncoder()),
    isSampled: () => open,
    markSubmitted: () => void (reached = true),
    hasSubmittedPart: () => reached,
    submitted: () => void calls.push('closed'),
    unreachedPart: () => void calls.push('unreached'),
    cancelUnsubmitted: () => void calls.push('cancelled'),
    cancelUnused: () => undefined,
  }
  assert.equal(dispatchWaitingSelection(f.rt), false)
  assert.deepEqual(f.failures, ['gpu-selection-dispatch-failed'])
  assert.deepEqual(calls, ['unreached', 'closed'])
})

test('a selection send that throws inside the submit, after the roots part reached the queue, closes the image with the roots', () => {
  const calls: string[] = []
  let reached = false
  let open = false
  const f = waiting(
    () => {
      submitPart(f.rt, f.device, createImagePart(f.rt, f.device))
      // From here the queue throws: the cut's own part is the one that fails.
      ;(f.device.queue as unknown as { submit: () => void }).submit = () => {
        throw new Error('refused')
      }
      return () => undefined
    },
    () => ({}),
  )
  Object.assign(f.rt.run, {
    imageRevision: 0,
    timedSamples: 0,
    frame: 0,
    gpuDrawCalls: 0,
    blendDrawCalls: 0,
    blendSubmittedTriangles: 0,
    lastCamera: null,
    gate: { cam: { eye: [0, 0, 0] } },
  })
  ;(f.rt.timing as { gpuTiming?: unknown }).gpuTiming = {
    createEncoder: () => ((open = true), f.device.createCommandEncoder()),
    isSampled: () => open,
    markSubmitted: () => void (reached = true),
    hasSubmittedPart: () => reached,
    submitted: () => void ((open = false), calls.push('closed')),
    unreachedPart: () => void calls.push('unreached'),
    cancelUnsubmitted: () => void calls.push('cancelled'),
    cancelUnused: () => undefined,
  }
  assert.equal(dispatchWaitingSelection(f.rt), false)
  assert.deepEqual(f.failures, ['gpu-selection-dispatch-failed'])
  assert.deepEqual(calls, ['unreached', 'closed'])
})

test('a cut that throws releases its part and closes the image though the part’s release threw: both ran, the failure is reported once', () => {
  const calls: string[] = []
  let reached = false
  let open = false
  const f = waiting(
    () => {
      submitPart(f.rt, f.device, createImagePart(f.rt, f.device))
      throw new Error('cut failed')
    },
    () => ({}),
  )
  Object.assign(f.rt.run, {
    imageRevision: 0,
    timedSamples: 0,
    frame: 0,
    gpuDrawCalls: 0,
    blendDrawCalls: 0,
    blendSubmittedTriangles: 0,
    lastCamera: null,
    gate: { cam: { eye: [0, 0, 0] } },
  })
  ;(f.rt.timing as { gpuTiming?: unknown }).gpuTiming = {
    createEncoder: () => ((open = true), f.device.createCommandEncoder()),
    isSampled: () => open,
    markSubmitted: () => void (reached = true),
    hasSubmittedPart: () => reached,
    submitted: () => void calls.push('closed'),
    unreachedPart: () => {
      calls.push('unreached')
      throw new Error('release failed')
    },
    cancelUnsubmitted: () => void calls.push('cancelled'),
    cancelUnused: () => undefined,
  }
  assert.equal(dispatchWaitingSelection(f.rt), false)
  assert.deepEqual(calls, ['unreached', 'closed'])
  assert.deepEqual(f.failures, ['gpu-selection-release-failed', 'gpu-selection-dispatch-failed'])
})

test('the waiting sends take distinct sample numbers, and a send the queue took answers true though a later step threw', () => {
  const numbers: number[] = []
  const f = waiting(
    () => () => undefined,
    () => ({}),
  )
  Object.assign(f.rt.run, {
    imageRevision: 7,
    timedSamples: 0,
    frame: 0,
    gpuDrawCalls: 0,
    blendDrawCalls: 0,
    blendSubmittedTriangles: 0,
    lastCamera: null,
    gate: { cam: { eye: [0, 0, 0] } },
  })
  let closing = (): void => undefined
  let open = false
  ;(f.rt.timing as { gpuTiming?: unknown }).gpuTiming = {
    createEncoder: () => ((open = true), f.device.createCommandEncoder()),
    isSampled: () => open,
    markSubmitted: () => undefined,
    hasSubmittedPart: () => true,
    submitted: (_: unknown, metadata: { submission: number }) => {
      open = false
      numbers.push(metadata.submission)
      closing()
    },
    cancelUnsubmitted: () => undefined,
    cancelUnused: () => undefined,
  }
  assert.equal(dispatchWaitingSelection(f.rt), true)
  assert.equal(dispatchWaitingSelection(f.rt), true)
  closing = () => {
    throw new Error('closing failed')
  }
  // The queue took the part; the closing threw after it: the send ran, the throw is reported.
  assert.equal(dispatchWaitingSelection(f.rt), true)
  assert.deepEqual(numbers, [1, 2, 3])
  assert.deepEqual(f.failures, ['gpu-selection-dispatch-failed'])
  assert.equal(f.rt.run.imageRevision, 7)
})
