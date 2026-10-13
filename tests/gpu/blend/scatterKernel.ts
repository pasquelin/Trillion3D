// The transparent plan's expansion kernel run on the GPU: its stages on one bind group laid out by
// the engine (`blendExpandBindEntries`, `EXPAND_BINDING`), dispatched as the engine dispatches them
// (`BLEND_EXPAND_ENTRIES`, `blendExpandDispatch`), then its two outputs read back — the expanded
// instance list and each run's indirect arguments.
import assert from 'node:assert/strict'
import {
  BLEND_EXPAND_ENTRIES,
  BLEND_EXPAND_SHADER,
  blendExpandDispatch,
} from '../../../packages/sdk-browser/src/webgpu/blend/expandWgsl.ts'
import {
  blendExpandBindEntries,
  EXPAND_BINDING,
} from '../../../packages/sdk-browser/src/webgpu/blend/expandBindings.ts'
import { UNI_WORDS } from '../../../packages/sdk-browser/src/webgpu/blend/expandUniform.ts'
import { EXPAND_GROUP } from '../../../packages/sdk-browser/src/webgpu/blend/planLayout.ts'
import { namedEntries } from '../../../packages/sdk-browser/src/gpu/core/computeBindings.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'

/** What the kernel reads, word for word, and how many words of each output it writes. */
export interface ExpansionInput {
  uniform: Uint32Array
  /** The sorted plan's entries, then its runs. */
  plan: Uint32Array
  entries: number
  runs: number
  keep: Uint32Array
  draws: Uint32Array
  /** The indirect counts the compaction wrote, four words per item. */
  counts: Uint32Array
  clusters: Uint32Array
  instanceWords: number
  argsWords: number
}

async function expand(input: ExpansionInput) {
  const gpu = await openGpuDevice()
  assert.ok(gpu, 'WebGPU must be available')
  const { device } = gpu
  const { module, compilation } = await gpu.compile(BLEND_EXPAND_SHADER)
  assert.deepEqual(compilation, [], 'the expansion kernel compiles')
  const buffer = (data: Uint32Array, usage: GPUBufferUsageFlags) => {
    const made = device.createBuffer({
      size: Math.max(16, data.byteLength),
      usage,
      mappedAtCreation: true,
    })
    new Uint32Array(made.getMappedRange()).set(data)
    made.unmap()
    return made
  }
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  // Each buffer under its WGSL name: `namedEntries` lays it at that name's binding.
  const buffers = {
    uni: {
      buffer: buffer(input.uniform, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      size: UNI_WORDS * 4,
    },
    plan: { buffer: buffer(input.plan, storage) },
    keep: { buffer: buffer(input.keep, storage) },
    draws: { buffer: buffer(input.draws, storage) },
    counts: { buffer: buffer(input.counts, storage) },
    clusters: { buffer: buffer(input.clusters, storage) },
    scratch: {
      buffer: buffer(
        new Uint32Array(input.entries + ceilDiv(input.entries, EXPAND_GROUP)),
        storage,
      ),
    },
    expanded: { buffer: buffer(new Uint32Array(input.instanceWords), storage) },
    args: { buffer: buffer(new Uint32Array(input.argsWords), storage) },
  }
  const layout = device.createBindGroupLayout({ entries: blendExpandBindEntries() })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const group = device.createBindGroup({
    layout,
    entries: namedEntries(EXPAND_BINDING, buffers),
  })
  const dispatches = blendExpandDispatch([], input.entries, input.runs)
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setBindGroup(0, group, [0])
  for (const [step, entryPoint] of BLEND_EXPAND_ENTRIES.entries()) {
    pass.setPipeline(
      device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } }),
    )
    pass.dispatchWorkgroups(dispatches[step])
  }
  pass.end()
  device.queue.submit([encoder.finish()])
  const [expanded, args] = [
    await readBuffer(device, buffers.expanded.buffer, 0, input.instanceWords * 4),
    await readBuffer(device, buffers.args.buffer, 0, input.argsWords * 4),
  ]
  const { court: adapter } = await gpu.fermer()
  assert.deepEqual(gpu.errors, [], 'the device reports no error')
  return { adapter, expanded, args }
}

/** Runs the expansion on `input` and returns the adapter and what the GPU wrote. */
export const expandOnGpu = (input: ExpansionInput) => runOnDawn(expand, input)
