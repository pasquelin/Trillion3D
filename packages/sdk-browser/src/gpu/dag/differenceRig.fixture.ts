// A resident cut on a recording device whose work runs when it is submitted, through the
// kernels' mirror: each cut writes the lists the test gives it, `dagCutDifference` and `dagCutKeep`
// run on the readout as `difference.fixture.ts` replays them, and copies, writes and readbacks move
// the words the real ones would. A command buffer never submitted runs nothing. What the readbacks
// hold is then the GPU's difference of the lists given, in the order the real dispatch copied them,
// for the host to adopt or not (`dispatch.ts`, `differenceChain.ts`).
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { bytesOf } from '../../../../../tests/kit/gpu/globals.ts';
import { createDagResources } from './resources.ts';
import { createDagRuntime } from './runtime.ts';
import { packDagSelection } from './selection.ts';
import { packRequest } from './request.ts';
import { keepSnapshot, writeDifference } from './difference.fixture.ts';
import { OUT_COUNT, OUT_FLAGS, SELECTION_HEADER_WORDS as HEAD } from './layout.ts';
import { dagFixture } from '../../page/selection/dag.fixture.ts';
import { packed } from './selectionHelpers.fixture.ts';

/** The two lists one cut publishes: the camera's requests, the drawn pages. */
export type RigCut = { asked: number[]; drawn: number[] };
type Op = () => void;

/** `dagMask` and the kernels before the snapshot, as their outputs: `cut` written into `out`, on a
 *  list of `cap` ranks; past it, the readout says it is truncated. */
export function writeCut(out: Uint32Array, cap: number, cut: RigCut) {
  const asked = cut.asked.slice(0, cap),
    drawn = cut.drawn.slice(0, cap);
  out.fill(0, 0, 2 * (HEAD + cap));
  out[OUT_COUNT] = cut.asked.length;
  out[OUT_FLAGS] = cut.asked.length > cap || cut.drawn.length > cap ? 1 : 0;
  out.set(
    asked.map((page) => packRequest(page, 1)),
    HEAD,
  );
  out[HEAD + cap] = cut.drawn.length;
  out.set(drawn, 2 * HEAD + cap);
}

/** `placements` placements of the fixture's primitive, cut on a list of `cap` ranks. */
export async function differenceRig(cap: number, placements = 40) {
  const [root] = packed(dagFixture()).roots;
  const dag = packDagSelection(Array.from({ length: placements }, () => root));
  const fake = fakeDevice();
  const words = new Map<GPUBuffer, Uint32Array>();
  const model = (buffer: GPUBuffer) => {
    let held = words.get(buffer);
    if (!held) words.set(buffer, (held = new Uint32Array(buffer.size >>> 2)));
    return held;
  };
  const device = fake.device;
  const create = device.createBuffer.bind(device);
  /** The readback slots, and how many copies into them ran. */
  const readbacks = new Set<GPUBuffer>();
  let copies = 0;
  device.createBuffer = (descriptor: GPUBufferDescriptor) => {
    const buffer = create(descriptor);
    if (descriptor.usage & GPUBufferUsage.MAP_READ) {
      readbacks.add(buffer);
      buffer.getMappedRange = () => model(buffer).slice().buffer;
    }
    return buffer;
  };
  device.queue.writeBuffer = (
    buffer: GPUBuffer,
    offset: number,
    data: GPUAllowSharedBufferSource,
    dataOffset?: number,
    size?: number,
  ) => {
    new Uint8Array(model(buffer).buffer).set(bytesOf(data, dataOffset, size), offset);
    return undefined;
  };
  device.queue.submit = (buffers: Iterable<GPUCommandBuffer>) => {
    for (const commands of buffers)
      for (const op of (commands as unknown as { ops: Op[] }).ops) op();
  };
  /** The lists the next cut writes. */
  let next: RigCut = { asked: [], drawn: [] };
  device.createCommandEncoder = () => {
    const ops: Op[] = [];
    let entry = '';
    // Each kernel runs on the readout and the cap of the dispatch that encoded it.
    const kernel = (name: string) => {
      const out = resources.output,
        listCap = resources.listCap;
      if (name === 'dagPrepare') {
        const cut = next;
        ops.push(() => writeCut(model(out), listCap, cut));
      } else if (name === 'dagCutDifference') ops.push(() => writeDifference(model(out), listCap));
      else if (name === 'dagCutKeep') ops.push(() => keepSnapshot(model(out), listCap));
    };
    const pass = new Proxy(
      {},
      {
        get: (_, name) =>
          name === 'setPipeline'
            ? (pipeline: { entryPoint: string }) => (entry = pipeline.entryPoint)
            : name === 'dispatchWorkgroups'
              ? () => kernel(entry)
              : () => {},
      },
    );
    return {
      beginComputePass: () => pass,
      copyBufferToBuffer(from: GPUBuffer, at: number, to: GPUBuffer, into: number, size: number) {
        ops.push(() => {
          model(to).set(model(from).subarray(at >>> 2, (at + size) >>> 2), into >>> 2);
          if (readbacks.has(to)) copies++;
        });
      },
      clearBuffer() {},
      finish: () => ({ ops }),
    } as unknown as GPUCommandEncoder;
  };
  const resources = (await createDagResources(device, dag, true, null, cap))!;
  const selection = createDagRuntime(resources);
  return {
    resources,
    selection,
    /** The pages a cut may name: the packed DAG's. */
    pageCount: dag.pageCount,
    /** The next cut writes `cut`. */
    cutNext: (cut: RigCut) => (next = cut),
    /** Snapshots copied into a readback slot so far. */
    copies: () => copies,
  };
}
