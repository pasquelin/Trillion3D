// A frame draws its shadow pages in as many batches as they take (#489), each batch a light cut.
// Every batch's requests must be read back, whatever the batch count: the cuts append to one list
// the frame copies once (`VIEW_APPEND`), so no batch's coarse view is redrawn for want of a report
// slot, and its missing casters are asked for. The GPU side here is the shader's contract, run on
// the buffers the host wrote: a cut resets the list unless its uniform says append, and a view
// whose caster is not resident draws coarser and requests it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice, type FakeBuffer } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { sunRun } from '../../webgpu/shadow/runs.fixture.ts';
import { createDagLightCut } from './lightCut.ts';
import { FRAME_VEC4 } from './types.ts';
import { OUT_COUNT, OUT_FLAGS, SELECTION_HEADER_WORDS } from './layout.ts';
import { packRequest } from './request.ts';
import { COARSER_VIEWS, DAG_UNIFORM_BYTES, LIST_FULL } from './shader/viewsWgsl.ts';
import { VIEW_FLAGS_WORD } from './uniforms.ts';
import { VIEW_APPEND } from './shader/pagesWgsl.ts';

const CASTERS = 16;

/** A light cut over `CASTERS` catalogue pages, on a device whose copies run as they are encoded. */
function lightCutFrame() {
  const { device, writes, buffers } = fakeDevice({
    limits: {
      maxComputeWorkgroupsPerDimension: 65535,
      maxStorageBufferBindingSize: 1 << 27,
      maxBufferSize: 1 << 28,
    } as GPUSupportedLimits,
  });
  const bytes = (buffer: GPUBuffer) => (buffer as unknown as FakeBuffer).getMappedRange();
  const encoder = {
    copyBufferToBuffer(from: GPUBuffer, at: number, to: GPUBuffer, toAt: number, size: number) {
      new Uint8Array(bytes(to)).set(new Uint8Array(bytes(from), at, size), toAt);
    },
    beginComputePass: () => ({
      setBindGroup() {},
      setPipeline() {},
      dispatchWorkgroups() {},
      dispatchWorkgroupsIndirect() {},
      end() {},
    }),
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
    outputBytes,
    readbackBytes: outputBytes,
    frameData: new Float32Array(FRAME_VEC4 * 4),
    frameWrites: { count: 0 },
    buffers: [],
  } as unknown as Parameters<typeof createDagLightCut>[0]);
  const output = buffers.find(({ label }) => label === 'Trillion3D light cut output')!;
  /** The GPU running the cut just encoded, over the view of `caster`, against `resident`. */
  const run = (caster: number, resident: Set<number>) => {
    const uniform = writes.findLast(({ buffer }) => buffer.size === DAG_UNIFORM_BYTES)!;
    const viewFlags = new Uint32Array(uniform.data.slice().buffer)[VIEW_FLAGS_WORD];
    const out = new Uint32Array(output.getMappedRange());
    if (viewFlags & VIEW_APPEND) out[OUT_FLAGS] &= LIST_FULL;
    else out[OUT_COUNT] = out[OUT_FLAGS] = 0;
    if (resident.has(caster)) return viewFlags;
    out[OUT_FLAGS] |= 1 << COARSER_VIEWS;
    const slot = out[OUT_COUNT]++;
    if (slot < CASTERS) out[SELECTION_HEADER_WORDS + slot] = packRequest(caster, 1);
    else out[OUT_FLAGS] |= LIST_FULL;
    return viewFlags;
  };
  const views = [{ uniforms: sunRun(64).uniforms }];
  /** One frame drawing `pages` in one batch each: the page is its caster. Returns the batches'
   *  view flags, whether each batch's requests will be read, and how many report copies ran. */
  const frame = async (pages: number[], resident: Set<number>) => {
    const settles: Array<(submitted: boolean) => void> = [],
      flags: number[] = [];
    for (const page of pages) {
      cut.encode(encoder, views, 1);
      flags.push(run(page, resident));
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

test("a frame of many batches reads back every batch's requests in one copy", async () => {
  const { cut, frame } = lightCutFrame();
  const pages = [0, 1, 2, 3, 4, 5, 6, 7];
  const { flags, copies } = await frame(pages, new Set());
  assert.equal(flags[0] & VIEW_APPEND, 0, 'the first cut starts the list');
  assert.ok(
    flags.slice(1).every((word) => (word & VIEW_APPEND) !== 0),
    'every later cut appends to it',
  );
  assert.equal(copies, 1, 'one copy for the frame');
  assert.deepEqual(
    cut.reports.takeRequests()?.sort((a, b) => a - b),
    pages,
    "every batch's missing caster is asked for",
  );
  const now: number[] = [];
  cut.redraws.takeRedraw((page) => now.push(page));
  assert.deepEqual(now, [], 'no coarse view is redrawn for want of a report slot');
});

test('a sweep of many batches a frame converges to full detail', async () => {
  const { cut, frame } = lightCutFrame();
  const resident = new Set<number>();
  let drawn = Array.from({ length: 12 }, (_, page) => page);
  for (let step = 0; step < 4 && drawn.length; step++) {
    await frame(drawn, resident);
    const asked = cut.reports.takeRequests() ?? [];
    for (const page of asked) resident.add(page);
    if (asked.length) cut.redraws.residencyChanged();
    cut.redraws.rest();
    const again: number[] = [];
    cut.redraws.takeRedraw((page) => again.push(page));
    drawn = again;
  }
  assert.equal(resident.size, 12, 'every caster was asked for and arrived');
  assert.deepEqual(drawn, [], 'every page is drawn at full detail, nothing left to redraw');
});
