// The settled engine (`settledRt`), its last complete frame drawn: what the held-frame metric tests
// read.
import { settledRt } from './hold.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { WebgpuTimingState } from '../pages/state/timing.ts'
import type { GpuPassTimings } from '../../../../sdk-core/src/contracts/metrics.ts'

/** An engine whose every `frameSettled` condition is true (`settledRt`), whose last two frames
 *  matched and whose last complete frame drew a lot, its steps and passes timed: that is what hold
 *  must not republish. Its presenter encodes the present. */
export function heldFrame() {
  const rt = settledRt(),
    { run, gpu } = rt
  run.gate.hold.keep(run.gate.revisions)
  run.gate.hold.keep(run.gate.revisions)
  Object.assign(run, {
    frame: 5,
    desired: [],
    drawn: [],
    imageRevision: 3,
    gpuDrawCalls: 42,
    blendDrawCalls: 7,
    submittedTriangles: 123456,
    blendSubmittedTriangles: 99,
    // What the frame SHOWS: the cut, which does not move.
    visible: 800,
    selectedTriangles: 123456,
    frustumRejected: 29987,
    lodLevel: 2,
    blendFrustumRejected: 11,
  })
  const timing = rt.timing as WebgpuTimingState & { lastGpuPassMs: GpuPassTimings }
  timing.lastGpuPassMs = { frame: 4, totalMs: 9, passes: [], truncated: false }
  Object.assign(timing, { lastGpuFrameMs: 9, lastGpuHostGapMs: 2, lastSubmitMs: 8 })
  timing.profiler.row.fill(7)
  timing.cpuSample = { version: 1 }
  Object.assign(gpu, {
    presenter: { present: () => {}, holds: () => false },
    displayTexture: {},
    cache: undefined,
    vertexBytes: 0,
    positionBuffers: new Map(),
  })
  Object.assign(rt, { setup: { geometryPool: { slots: 0 }, texturePool: {} } })
  Object.assign(rt.services, { residencySets: { keepCount: 0 } })
  Object.assign(rt.lights, { memory: { bias: 0, events: [] } })
  Object.assign(rt.blendState, { visibleBlend: [] })
  const { device } = fakeDevice()
  return { rt: rt as WebgpuPagesRuntime, run, timing, device }
}
