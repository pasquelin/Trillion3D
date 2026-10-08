// The bench's pass timer detects the cases it must: a pass made slow on purpose is the frame's
// biggest, a pass with nothing to do is told from a timer the driver never wrote, and an idle the
// proof injects between two submits is read as the wait before the second pass, never as its work.
import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { installGpu } from '../../../bench/dawn/device.ts'
import type { FrameGpu } from '../../../bench/dawn/passSpans.ts'
import { runOnDawn } from '../kit/onDawn.ts'

const SLOW = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> out: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  var x = f32(id.x) * 0.001;
  for (var i = 0u; i < 20000u; i++) { x = fract(x * 1.7 + 0.31) + sin(x); }
  out[id.x] = x;
}`
const LIGHT = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> out: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) { out[id.x] = f32(id.x); }`

/** Times the passes `encode` makes, in the submits it makes, on a fresh device. */
async function timed(
  encode: (device: GPUDevice, pass: (code: string, groups: number) => void) => Promise<void>,
) {
  const gpu = installGpu({ limits: null, featuresOff: [] })
  const adapter = (await navigator.gpu.requestAdapter())!
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] })
  const out = device.createBuffer({ size: 1 << 20, usage: GPUBufferUsage.STORAGE })
  const encoder = device.createCommandEncoder()
  const pass = (code: string, groups: number, label = code === SLOW ? 'slow' : 'light') => {
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
    })
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: out } }],
    })
    const p = encoder.beginComputePass({ label })
    p.setPipeline(pipeline)
    p.setBindGroup(0, bind)
    if (groups) p.dispatchWorkgroups(groups)
    p.end()
  }
  await device.queue.onSubmittedWorkDone()
  gpu.timer.open(device)
  await encode(device, (code, groups) => pass(code, groups))
  device.queue.submit([encoder.finish()])
  const frame = (await gpu.timer.close()) as FrameGpu
  return {
    frame,
    device,
  }
}

test(
  'a pass slowed on purpose is the biggest, an empty one is not a lost timer',
  { timeout: 120_000 },
  async () => {
    const { frame } = await runOnDawn(
      () =>
        timed(async (_device, pass) => {
          pass(LIGHT, 0) // nothing dispatched
          pass(SLOW, 256)
          pass(LIGHT, 1)
        }),
      null,
    )
    const [empty, slow, light] = frame.passes
    assert.ok(
      frame.passes.every((p) => p.state !== 'lost'),
      JSON.stringify(frame.passes),
    )
    assert.ok(slow.ms > 10 * light.ms, `slow ${slow.ms} ms, light ${light.ms} ms`)
    assert.ok(slow.ms > frame.unionMs * 0.8, 'the slow pass is most of the frame')
    assert.ok(empty.spanMs < slow.spanMs / 20, `empty ${empty.spanMs} ms`)
  },
)

test(
  "an idle injected between two submits is the second pass's wait, not its work",
  { timeout: 120_000 },
  async () => {
    const IDLE_MS = 8
    const { frame } = await runOnDawn(async () => {
      const run = await timed(async (_d, pass) => pass(LIGHT, 1))
      return run
    }, null)
    assert.ok(frame.passes[0].gapMs === 0)
    // The idle: a second frame window holding two submits, the CPU sleeping between them.
    const idle = await runOnDawn(async () => {
      const gpu = installGpu({ limits: null, featuresOff: [] })
      const adapter = (await navigator.gpu.requestAdapter())!
      const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] })
      const out = device.createBuffer({ size: 4096, usage: GPUBufferUsage.STORAGE })
      const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: LIGHT }), entryPoint: 'main' },
      })
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: out } }],
      })
      const submit = () => {
        const encoder = device.createCommandEncoder()
        const p = encoder.beginComputePass({ label: 'light' })
        p.setPipeline(pipeline)
        p.setBindGroup(0, bind)
        p.dispatchWorkgroups(1)
        p.end()
        device.queue.submit([encoder.finish()])
      }
      gpu.timer.open(device)
      submit()
      await device.queue.onSubmittedWorkDone()
      await sleep(IDLE_MS)
      submit()
      return (await gpu.timer.close()) as FrameGpu
    }, null)
    const [first, second] = idle.passes
    assert.ok(second.gapMs > IDLE_MS * 0.6, `wait ${second.gapMs} ms for an idle of ${IDLE_MS} ms`)
    assert.ok(second.ms < 1, `the second pass's own work is ${second.ms} ms`)
    assert.ok(first.gapMs === 0 && idle.gapMs > IDLE_MS * 0.6)
  },
)
