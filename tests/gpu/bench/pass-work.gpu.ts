// What the bench reads of a pass's encoding is what the engine encoded: the threads of a dispatch
// whose workgroup size is an override the pipeline sets, a depth attachment read only that stores
// nothing, a render bundle or an indirect dispatch the bench cannot size.
import assert from 'node:assert/strict'
import test from 'node:test'
import { installGpu } from '../../../bench/dawn/device.ts'
import type { FrameGpu } from '../../../bench/dawn/passSpans.ts'
import { runOnDawn } from '../kit/onDawn.ts'

const KERNEL = /* wgsl */ `
override WG: u32 = 64;
@group(0) @binding(0) var<storage, read_write> out: array<u32>;
@compute @workgroup_size(WG) fn main(@builtin(global_invocation_id) id: vec3u) { out[id.x] = id.x; }`

test(
  'a workgroup size the pipeline overrides is the one counted; indirect work is unsized',
  { timeout: 120_000 },
  async () => {
    const frame = await runOnDawn(async () => {
      const gpu = installGpu({ limits: null, featuresOff: [] })
      const adapter = (await navigator.gpu.requestAdapter())!
      const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] })
      const out = device.createBuffer({ size: 1 << 16, usage: GPUBufferUsage.STORAGE })
      const args = device.createBuffer({
        size: 12,
        usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(args, 0, new Uint32Array([2, 1, 1]))
      const module = device.createShaderModule({ code: KERNEL })
      const make = (constants?: Record<string, number>) =>
        device.createComputePipeline({
          layout: 'auto',
          compute: { module, entryPoint: 'main', constants },
        })
      const run = (
        pipeline: GPUComputePipeline,
        label: string,
        encode: (p: GPUComputePassEncoder) => void,
      ) => {
        const bind = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: out } }],
        })
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginComputePass({ label })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bind)
        encode(pass)
        pass.end()
        device.queue.submit([encoder.finish()])
      }
      await device.queue.onSubmittedWorkDone()
      gpu.timer.open(device)
      run(make({ WG: 128 }), 'overridden', (p) => p.dispatchWorkgroups(10))
      run(make(), 'default', (p) => p.dispatchWorkgroups(10))
      run(make(), 'indirect', (p) => p.dispatchWorkgroupsIndirect(args, 0))
      return (await gpu.timer.close()) as FrameGpu
    }, null)
    const by = Object.fromEntries(frame.passes.map((p) => [p.label, p.work]))
    assert.equal(by.overridden.invocations, 1280, '10 groups of the 128 threads the pipeline sets')
    assert.equal(by.default.invocations, 640)
    assert.equal(by.overridden.unsized, 0)
    assert.equal(by.indirect.indirect, 1)
    assert.equal(by.indirect.unsized, 1, 'what an indirect dispatch runs only the GPU knows')
    assert.equal(by.overridden.boundBytes, 1 << 16)
  },
)

const DRAW = /* wgsl */ `
@vertex fn vs(@location(0) p: vec2f) -> @builtin(position) vec4f { return vec4f(p, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }`

test(
  'a vertex buffer and an index buffer are read by the draws: their slices are bound bytes',
  { timeout: 120_000 },
  async () => {
    const frame = await runOnDawn(async () => {
      const gpu = installGpu({ limits: null, featuresOff: [] })
      const adapter = (await navigator.gpu.requestAdapter())!
      const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] })
      const module = device.createShaderModule({ code: DRAW })
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module,
          buffers: [
            { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          ],
        },
        fragment: { module, targets: [{ format: 'rgba8unorm' }] },
      })
      const target = device.createTexture({
        size: [64, 64],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
      const vertices = device.createBuffer({ size: 4096, usage: GPUBufferUsage.VERTEX })
      const indices = device.createBuffer({ size: 1024, usage: GPUBufferUsage.INDEX })
      await device.queue.onSubmittedWorkDone()
      gpu.timer.open(device)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        label: 'drawn',
        colorAttachments: [
          {
            view: target.createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 0],
          },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setVertexBuffer(0, vertices, 0, 2048)
      pass.setIndexBuffer(indices, 'uint16')
      pass.drawIndexed(3)
      pass.end()
      device.queue.submit([encoder.finish()])
      return (await gpu.timer.close()) as FrameGpu
    }, null)
    const [drawn] = frame.passes
    assert.equal(
      drawn.work.boundBytes,
      2048 + 1024,
      'the vertex slice, then the whole index buffer',
    )
    assert.equal(drawn.work.attachBytes, 64 * 64 * 4)
    assert.equal(drawn.work.vertices, 3)
  },
)
