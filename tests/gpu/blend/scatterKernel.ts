// The transparent plan's expansion kernel run on the GPU: its stages on one bind group laid out by
// the engine (`blendExpandBindEntries`, `EXPAND_BINDING`), dispatched as the engine dispatches them
// (`BLEND_EXPAND_ENTRIES`, `blendExpandDispatch`), then its two outputs read back — the expanded
// instance list and each run's indirect arguments.
import assert from 'node:assert/strict';
import {
  BLEND_EXPAND_ENTRIES,
  BLEND_EXPAND_SHADER,
  blendExpandDispatch,
} from '../../../packages/sdk-browser/src/webgpu/blend/expandWgsl.ts';
import {
  blendExpandBindEntries,
  EXPAND_BINDING,
} from '../../../packages/sdk-browser/src/webgpu/blend/expandBindings.ts';
import { UNI_WORDS } from '../../../packages/sdk-browser/src/webgpu/blend/expandUniform.ts';
import { EXPAND_GROUP } from '../../../packages/sdk-browser/src/webgpu/blend/planLayout.ts';
import { namedBufferEntries } from '../../../packages/sdk-browser/src/gpu/core/computeBindings.ts';
import { runOnDawn } from '../kit/onDawn.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';

/** What the kernel reads, word for word, and how many words of each output it writes. */
export interface ExpansionInput {
  uniform: Uint32Array;
  /** The sorted plan's entries, then its runs. */
  plan: Uint32Array;
  entries: number;
  runs: number;
  keep: Uint32Array;
  draws: Uint32Array;
  /** The indirect counts the compaction wrote, four words per item. */
  counts: Uint32Array;
  clusters: Uint32Array;
  instanceWords: number;
  argsWords: number;
}

async function expand(input: ExpansionInput) {
  const gpu = await openGpuDevice();
  assert.ok(gpu, 'WebGPU must be available');
  const { device } = gpu;
  const { module, compilation } = await gpu.compile(BLEND_EXPAND_SHADER);
  assert.deepEqual(compilation, [], 'the expansion kernel compiles');
  const buffer = (data: Uint32Array, usage: GPUBufferUsageFlags) => {
    const made = device.createBuffer({
      size: Math.max(16, data.byteLength),
      usage,
      mappedAtCreation: true,
    });
    new Uint32Array(made.getMappedRange()).set(data);
    made.unmap();
    return made;
  };
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  // Each buffer under its WGSL name: `namedBufferEntries` lays it at that name's binding.
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
        new Uint32Array(input.entries + Math.ceil(input.entries / EXPAND_GROUP)),
        storage,
      ),
    },
    expanded: { buffer: buffer(new Uint32Array(input.instanceWords), storage) },
    args: { buffer: buffer(new Uint32Array(input.argsWords), storage) },
  };
  const layout = device.createBindGroupLayout({ entries: blendExpandBindEntries() });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const group = device.createBindGroup({
    layout,
    entries: namedBufferEntries(EXPAND_BINDING, buffers),
  });
  const dispatches = blendExpandDispatch([], input.entries, input.runs);
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setBindGroup(0, group, [0]);
  for (const [step, entryPoint] of BLEND_EXPAND_ENTRIES.entries()) {
    pass.setPipeline(
      device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } }),
    );
    pass.dispatchWorkgroups(dispatches[step]);
  }
  pass.end();
  const targets = (
    [
      [buffers.expanded.buffer, input.instanceWords],
      [buffers.args.buffer, input.argsWords],
    ] as const
  ).map(([source, words]) => {
    const target = device.createBuffer({
      size: words * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyBufferToBuffer(source, 0, target, 0, words * 4);
    return target;
  });
  device.queue.submit([encoder.finish()]);
  const [expanded, args] = await Promise.all(
    targets.map(async (target) => {
      await target.mapAsync(GPUMapMode.READ);
      return new Uint32Array(target.getMappedRange().slice(0));
    }),
  );
  const { court: adapter } = await gpu.fermer();
  assert.deepEqual(gpu.errors, [], 'the device reports no error');
  return { adapter, expanded, args };
}

/** Runs the expansion on `input` and returns the adapter and what the GPU wrote. */
export const expandOnGpu = (input: ExpansionInput) => runOnDawn(expand, input);
