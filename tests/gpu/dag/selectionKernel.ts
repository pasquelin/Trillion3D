// The DAG selection kernel run on the GPU: each case's buffers as the engine lays them out
// (`selectionCase.ts`), the stages `dagPrepare`, the level descent, `dagWanted`, `dagMask` and
// `dagSortRequests` in the engine's order (`gpu/dag/encode.ts`) for a cut that starts from fresh
// buffers, then the readout, the frame counters and the draw flags read back.
import assert from 'node:assert/strict';
import { DAG_SELECTION_SHADER } from '../../../packages/sdk-browser/src/gpu/dag/shader/shader.ts';
import {
  DAG_BINDING,
  dagBindEntries,
} from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts';
import { namedBufferEntries } from '../../../packages/sdk-browser/src/gpu/core/computeBindings.ts';
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { REQUEST_PAGE_MAX } from '../../../packages/sdk-browser/src/gpu/dag/request.ts';
import { LEVEL_QUEUES } from '../../../packages/sdk-browser/src/gpu/dag/shader/levelWgsl.ts';
import {
  OUT_COUNT,
  OUT_FLAGS,
  OUT_FRUSTUM_REJECTED,
  OUT_SELECTED_TRIANGLES,
  OUT_TRANSPARENT_TRIANGLES,
  SELECTION_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';
import { runOnDawn } from '../kit/onDawn.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';
import { caseBuffers, type SelectionCase } from './selectionCase.ts';

export type { SelectionCase } from './selectionCase.ts';

/** What one case's cut left on the GPU. */
interface SelectionReading {
  name: string;
  /** Request words (page and priority) in the order the GPU sorted them. */
  requests: number[];
  /** The requested pages, in increasing order. */
  pages: number[];
  frustumRejected: number;
  overflow: number;
  selectedTriangles: number;
  transparentTriangles: number;
  /** Pages `dagMask` flagged drawn, in increasing order. */
  drawn: number[];
  /** The descent's candidates and the live clusters `dagWanted` kept: what the frame rereads. */
  candidates: number;
  live: number;
}

async function readWords(device: GPUDevice, source: GPUBuffer, offset: number, bytes: number) {
  const target = device.createBuffer({
    size: Math.max(4, bytes),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  if (bytes) encoder.copyBufferToBuffer(source, offset, target, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await target.mapAsync(GPUMapMode.READ);
  const words = new Uint32Array(target.getMappedRange().slice(0, bytes));
  target.destroy();
  return words;
}

async function runCases({ cases, shader }: { cases: SelectionCase[]; shader: string }) {
  const gpu = await openGpuDevice();
  assert.ok(gpu, 'WebGPU must be available');
  const { device } = gpu;
  const { module, compilation } = await gpu.compile(shader);
  assert.deepEqual(compilation, [], 'the selection kernel compiles');
  const layout = device.createBindGroupLayout({ entries: dagBindEntries() });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const stage = (entryPoint: string) =>
    device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
  const prepare = stage('dagPrepare'),
    levels = Array.from({ length: LEVEL_QUEUES }, (_, q) => stage(`dagLevel${q}`)),
    wanted = stage('dagWanted'),
    mask = stage('dagMask'),
    sort = stage('dagSortRequests');
  const groups = (threads: number) => Math.max(1, Math.ceil(threads / SELECTION_WORKGROUP));
  const readings: SelectionReading[] = [];
  for (const selection of cases) {
    const { packed } = selection;
    const at = caseBuffers(selection);
    const made: GPUBuffer[] = [];
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const buffer = (size: number, data?: ArrayBufferView, usage = storage) => {
      const created = device.createBuffer({
        size: Math.max(16, size, data?.byteLength ?? 0),
        usage,
      });
      if (data) device.queue.writeBuffer(created, 0, data.buffer, data.byteOffset, data.byteLength);
      made.push(created);
      return { buffer: created };
    };
    const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    const buffers = {
      clusters: buffer(64, at.clusters),
      nodes: buffer(64, at.nodes),
      views: buffer(256, at.views, uniform),
      flags: buffer(at.flagsWords * 4),
      out: buffer(at.outBytes),
      work: buffer(at.work.words * 4),
      worlds: buffer(64, at.worlds),
      frames: buffer(at.framesBytes, at.frames),
      cold: buffer(48, at.cold),
      range: buffer(16, at.range, uniform),
    };
    const group = device.createBindGroup({
      layout,
      entries: namedBufferEntries(DAG_BINDING, buffers),
    });
    const encoder = device.createCommandEncoder();
    // The whole descent in one pass, as the engine encodes it: each dispatch sees what the one
    // before wrote, each level dispatched flat over a bound of its node count.
    const head = encoder.beginComputePass();
    head.setBindGroup(0, group);
    // A thread per primitive, and at least one per block of pages: it resets the block counts.
    head.setPipeline(prepare);
    head.dispatchWorkgroups(groups(Math.max(at.worldCount, groups(packed.pageCount))));
    for (let level = 0; level < Math.max(1, packed.levelSizes.length); level++) {
      head.setPipeline(levels[level % LEVEL_QUEUES]);
      head.dispatchWorkgroups(groups(packed.nodeCount));
    }
    head.end();
    // The kept leaves' pages, then their verdict and the requests' sort: `pageCount` bounds the
    // candidate list and the live list.
    const tail = encoder.beginComputePass();
    tail.setBindGroup(0, group);
    for (const pipeline of [wanted, mask]) {
      tail.setPipeline(pipeline);
      tail.dispatchWorkgroups(groups(packed.pageCount));
    }
    tail.setPipeline(sort);
    tail.dispatchWorkgroups(1);
    tail.end();
    device.queue.submit([encoder.finish()]);
    const header = SELECTION_HEADER_WORDS;
    const out = await readWords(device, buffers.out.buffer, 0, (header + packed.pageCount) * 4);
    const work = await readWords(device, buffers.work.buffer, 0, at.work.words * 4);
    // Draw flags, one per page, behind the descent queue (`queueCap` is the node count).
    const flags = await readWords(
      device,
      buffers.flags.buffer,
      packed.nodeCount * 4,
      packed.pageCount * 4,
    );
    const requests = Array.from(
      out.subarray(header, header + Math.min(out[OUT_COUNT], packed.pageCount)),
    );
    readings.push({
      name: selection.name,
      requests,
      pages: requests.map((word) => word & (REQUEST_PAGE_MAX - 1)).sort((a, b) => a - b),
      frustumRejected: out[OUT_FRUSTUM_REJECTED],
      overflow: out[OUT_FLAGS],
      selectedTriangles: out[OUT_SELECTED_TRIANGLES],
      transparentTriangles: out[OUT_TRANSPARENT_TRIANGLES],
      drawn: [...flags.keys()].filter((page) => flags[page]),
      candidates: work[at.work.candCounter],
      live: work[at.work.liveCounter],
    });
    for (const created of made) created.destroy();
  }
  const { court: adapter } = await gpu.fermer();
  assert.deepEqual(gpu.errors, [], 'the device reports no error');
  return { adapter, readings };
}

/**
 * Runs the selection kernel — `shader`, the shipped one by default, or a variant to compare it
 * with — on every case, and returns the adapter and one reading per case, in order. A device
 * that is missing, a text that does not compile or a GPU error fails the call.
 */
export function runSelectionKernel(cases: SelectionCase[], shader = DAG_SELECTION_SHADER) {
  return runOnDawn(runCases, { cases, shader });
}
