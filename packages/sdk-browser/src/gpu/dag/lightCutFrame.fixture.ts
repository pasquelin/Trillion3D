// A light cut over a small catalogue, on a device whose copies run as they are encoded. The GPU side
// is the shader's contract, run on the buffers the host wrote: a cut resets the list unless its
// uniform says append, the first view to want a caster in the frame lists it and every view raises
// its best request (`askedWord`), the frame's list then takes those best requests (`dagAskedBest`),
// and a view whose caster is not resident draws coarser.
import { fakeDevice, type FakeBuffer } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { sunRun } from '../../webgpu/shadow/runs.fixture.ts';
import { createDagLightCut } from './lightCut.ts';
import { FRAME_VEC4 } from './types.ts';
import { OUT_COUNT, OUT_FLAGS, SELECTION_HEADER_WORDS } from './layout.ts';
import { packRequest, requestPage } from './request.ts';
import { COARSER_VIEWS, DAG_UNIFORM_BYTES, LIST_FULL } from './shader/viewsWgsl.ts';
import { VIEW_FLAGS_WORD } from './uniforms.ts';
import { VIEW_APPEND } from './shader/pagesWgsl.ts';
import { dagWorkLayout } from './shader/floorWgsl.ts';

const CASTERS = 16;
/** The pipeline of `dagAskedBest`: a dispatch under it runs the kernel's contract. */
const ASKED_BEST = {};

/** A light cut over `CASTERS` catalogue pages, on a device whose copies run as they are encoded. */
export function lightCutFrame() {
  const { device, writes, buffers } = fakeDevice({
    limits: {
      maxComputeWorkgroupsPerDimension: 65535,
      maxStorageBufferBindingSize: 1 << 27,
      maxBufferSize: 1 << 28,
    },
  });
  const bytes = (buffer: GPUBuffer) => (buffer as unknown as FakeBuffer).getMappedRange();
  const encoder = {
    copyBufferToBuffer(from: GPUBuffer, at: number, to: GPUBuffer, toAt: number, size: number) {
      new Uint8Array(bytes(to)).set(new Uint8Array(bytes(from), at, size), toAt);
    },
    clearBuffer(buffer: GPUBuffer, at: number, size: number) {
      new Uint8Array(bytes(buffer), at, size).fill(0);
    },
    beginComputePass: () => {
      let pipeline: unknown;
      return {
        setBindGroup() {},
        setPipeline: (next: unknown) => (pipeline = next),
        dispatchWorkgroups: () => pipeline === ASKED_BEST && askedBest(),
        dispatchWorkgroupsIndirect() {},
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  const outputBytes = (SELECTION_HEADER_WORDS + CASTERS) * 4;
  const packed = { pageCount: CASTERS, nodeCount: CASTERS, worldCount: 1 };
  const cut = createDagLightCut({
    device,
    packed,
    residentCut: false,
    pageCount: CASTERS,
    nodeCount: CASTERS,
    worldCount: 1,
    blockCount: 1,
    levelSizes: [1],
    levelPipelines: [{}],
    askedBestPipeline: ASKED_BEST,
    outputBytes,
    readbackBytes: outputBytes,
    frameData: new Float32Array(FRAME_VEC4 * 4),
    frameWrites: { count: 0 },
    buffers: [],
  } as unknown as Parameters<typeof createDagLightCut>[0]);
  const output = buffers.find(({ label }) => label === 'Trillion3D light cut output')!;
  const work = buffers.find(({ label }) => label === 'Trillion3D light cut work')!;
  const { askedAt } = dagWorkLayout(1, cut.capacity, CASTERS);
  const out = () => new Uint32Array(output.getMappedRange()),
    best = () => new Uint32Array(work.getMappedRange());
  /** `dagAskedBest`: each listed page takes its best request of the frame. */
  const askedBest = () => {
    const list = out();
    for (let s = 0; s < Math.min(list[OUT_COUNT], CASTERS); s++) {
      const at = SELECTION_HEADER_WORDS + s;
      list[at] = best()[askedAt + requestPage(list[at])];
    }
  };
  /** The GPU running the cut just encoded, over a view that wants each `[caster, priority]` of
   *  `asks`, against `resident`. */
  const run = (asks: number[][], resident: Set<number>) => {
    const uniform = writes.findLast(({ buffer }) => buffer.size === DAG_UNIFORM_BYTES)!;
    const viewFlags = new Uint32Array(uniform.data.slice().buffer)[VIEW_FLAGS_WORD];
    const list = out(),
      words = best();
    if (viewFlags & VIEW_APPEND) list[OUT_FLAGS] &= LIST_FULL;
    else list[OUT_COUNT] = list[OUT_FLAGS] = 0;
    for (const [caster, priority] of asks) {
      if (!resident.has(caster)) list[OUT_FLAGS] |= 1 << COARSER_VIEWS;
      const word = packRequest(caster, priority),
        before = words[askedAt + caster];
      words[askedAt + caster] = Math.max(before, word);
      if (before) continue;
      const slot = list[OUT_COUNT]++;
      if (slot < CASTERS) list[SELECTION_HEADER_WORDS + slot] = word;
      else list[OUT_FLAGS] |= LIST_FULL;
    }
    return viewFlags;
  };
  const views = [{ uniforms: sunRun(64).uniforms }];
  /** One frame drawing `pages` in one batch each, whose view asks `wants(page)`: the page itself
   *  by default. Returns the batches' view flags and how many report copies ran. */
  const frame = async (
    pages: number[],
    resident: Set<number>,
    wants = (page: number) => [[page, 1]],
  ) => {
    const settles: Array<(submitted: boolean) => void> = [],
      flags: number[] = [];
    for (const page of pages) {
      cut.encode(encoder, views, 1);
      flags.push(run(wants(page), resident));
      const settle = cut.redraws.encode(encoder, [page], [0], 1);
      if (settle) settles.push(settle);
    }
    const report = cut.encodeReports(encoder);
    for (const settle of [report, ...settles]) settle?.(true);
    await cut.settled();
    return { flags, copies: report ? 1 : 0 };
  };
  return { cut, frame };
}
