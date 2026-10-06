// A parent that turns with its children composed on the GPU writes no CPU world: the GPU cut,
// which compares the CPU worlds it is sent, must still cut again under the composed ones. The roots
// pass announces the move to the selection on exactly the frames a parent moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import {
  askComposedPlacements,
  composeWebgpuPlacements,
  encodeComposedRoots,
  encodeComposedRows,
} from './gpuCompose.ts';
import { pipelinesCompiling, pipelinesSettled } from '../lighting/deferred/fullscreen.ts';
import { decideComposedMotion, MOTION_SCAN, MOTION_SKIP } from './composedMotion.ts';
import { createPlacementRows } from './rows.ts';
import { NONE } from './gpuComposeWgsl.ts';
import { composeRuntime } from './composeRuntime.fixture.ts';

const turn = (angle: number) => {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 2, 0, -3, 1];
};

/** A session of two linked roots, its selection counting the world revisions it is told of. */
function session() {
  const fake = fakeDevice(),
    device = fake.device as unknown as GPUDevice;
  // The recording device's compute pipeline is its stage; the pass binds through its layout.
  const createComputePipeline = device.createComputePipeline.bind(device);
  const compiled = { sync: 0, async: 0 };
  const bindable = (descriptor: GPUComputePipelineDescriptor) =>
    Object.assign(createComputePipeline(descriptor), { getBindGroupLayout: () => ({}) });
  device.createComputePipeline = (descriptor) => (compiled.sync++, bindable(descriptor));
  device.createComputePipelineAsync = async (descriptor) => (
    compiled.async++,
    bindable(descriptor)
  );
  const rows = createPlacementRows(2);
  const roots = [0, 1].map((index) => ({
    placement: { rows, index },
    world: { elements: new Float32Array(turn(index)) },
  }));
  let revision = 0;
  const selection = {
    worldRanges: [{ first: 0, count: 2, buffer: device.createBuffer({ size: 128, usage: 0 }) }],
    worldsMovedOnGpu: () => void revision++,
  };
  const rt = composeRuntime(roots, {
    frame: 0,
    worldUploadOrigin: new Float64Array(3),
    gpuSelection: selection,
    gpuComputeDispatches: 0,
  });
  const encoder = {
    beginComputePass: () => ({
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups() {},
      end() {},
    }),
  } as unknown as GPUCommandEncoder;
  const frame = () => {
    rt.run.frame++;
    encodeComposedRoots(rt, device, encoder);
    return revision;
  };
  return { rt, rows, frame, device, encoder, compiled, writes: fake.writes };
}

test("a parent's turn advances the cut's world revision on the frame it moved, and only then", () => {
  const { rt, rows, frame } = session();
  const parent = {},
    local = turn(0.4);
  const links = [0, 1].map((index) => ({ rows, index, local }));
  assert.equal(composeWebgpuPlacements(rt, parent, turn(0), links, true), true);
  assert.equal(frame(), 0, 'the link frame: the rows were written whole, the CPU worlds moved');
  assert.equal(frame(), 0, 'a still parent moves nothing');
  composeWebgpuPlacements(rt, parent, turn(0.1), [], false);
  assert.equal(frame(), 1, 'the turn: no row written, the cut is told');
  assert.equal(frame(), 1, 'the next still frame keeps the cut');
  composeWebgpuPlacements(rt, parent, turn(0.2), [], false);
  composeWebgpuPlacements(rt, parent, turn(0.3), [], false);
  assert.equal(frame(), 2, 'two sends before one frame: one cut');
  composeWebgpuPlacements(rt, parent, turn(0.3), [], false);
  assert.equal(frame(), 2, 'the same world sent again moves nothing');
});

test('a parent unlinked and linked anew starts from its new world: no motion from its old one', () => {
  const { rt, rows, frame } = session();
  const parent = {},
    links = [0, 1].map((index) => ({ rows, index, local: turn(0) }));
  composeWebgpuPlacements(rt, parent, turn(0), links, true);
  frame();
  assert.equal(composeWebgpuPlacements(rt, parent, turn(0), [], true), true, 'unlinked');
  assert.deepEqual([...rt.compose!.parentOf], [NONE, NONE]);
  assert.equal(composeWebgpuPlacements(rt, parent, turn(1), [], false), false, 'holds none');
  composeWebgpuPlacements(rt, parent, turn(2), links.slice(1), true);
  assert.deepEqual([...rt.compose!.parentOf], [NONE, 0], 'its slot taken again, one root');
  assert.equal(frame(), 0, 'linked at its new world: nothing moved on the GPU');
});

test('the compose kernels are asked once a parent links rows, the frames held until they compiled off the thread', async () => {
  const { rt, rows, frame, device, encoder, compiled } = session();
  askComposedPlacements(rt, device);
  assert.equal(pipelinesCompiling(device), false, 'no link, nothing asked');
  const links = [0, 1].map((index) => ({ rows, index, local: turn(0) }));
  composeWebgpuPlacements(rt, {}, turn(0), links, true);
  askComposedPlacements(rt, device);
  assert.equal(pipelinesCompiling(device), true, 'the next frame is held on them');
  await pipelinesSettled(device, true);
  assert.equal(pipelinesCompiling(device), false);
  frame();
  Object.assign(rt, { vis: { pageTable: device.createBuffer({ size: 64, usage: 0 }) } });
  Object.assign(rt.layout, { rows: { rowCount: 2 } });
  encodeComposedRows(rt, device, encoder);
  assert.deepEqual(compiled, { sync: 0, async: 2 }, 'both kernels compiled off the frame, once');
});

test("the linked roots' motion waits for the temporal pass's decision, written before the image leaves", () => {
  const { rt, rows, frame, device, writes } = session();
  const motionBuffer = device.createBuffer({ size: 128, usage: 0 });
  const held = new Float64Array(turn(0.25));
  (rt.gpu as { temporal?: unknown }).temporal = {
    frame: { active: true },
    motion: { buffer: motionBuffer, poseOf: () => held },
  };
  const local = turn(0.4);
  composeWebgpuPlacements(rt, {}, turn(0), [{ rows, index: 1, local }], true);
  writes.length = 0;
  frame();
  const label = (write: (typeof writes)[number]) => (write.buffer as { label?: string }).label;
  // The root linked now starts from the pose the CPU motion last accumulated it at.
  const seed = writes.find((write) => label(write) === 'Trillion3D composed previous worlds');
  assert.equal(seed?.offset, 64);
  assert.deepEqual([...(seed!.data as Float32Array)], [...Float32Array.from(held)]);
  const modes = () =>
    writes
      .filter((write) => label(write) === 'Trillion3D composed motion mode')
      .map((write) => (write.data as Uint32Array)[0]);
  assert.deepEqual(modes(), [MOTION_SKIP], 'encoded with no motion until the decision');
  decideComposedMotion(rt, device, [1, 2, 3], MOTION_SCAN);
  assert.deepEqual(
    modes(),
    [MOTION_SKIP, MOTION_SCAN],
    'the decision overwrites it, in queue order',
  );
  // A motion buffer the pass did not bind is never decided for.
  (rt.gpu as { temporal: { motion: { buffer: unknown } } }).temporal.motion.buffer = {};
  decideComposedMotion(rt, device, [1, 2, 3], MOTION_SCAN);
  assert.equal(modes().length, 2);
});

test('a whole link set sent again keeps the motion pose of the roots it already held', () => {
  const { rt, rows, frame, writes } = session();
  const parent = {},
    links = [0, 1].map((index) => ({ rows, index, local: turn(0.4) }));
  const seeded = () =>
    writes
      .filter(
        (write) =>
          (write.buffer as { label?: string }).label === 'Trillion3D composed previous worlds',
      )
      .map((write) => write.offset / 64);
  composeWebgpuPlacements(rt, parent, turn(0), links, true);
  frame();
  assert.deepEqual(seeded(), [0, 1], 'both linked now: both start from their CPU pose');
  writes.length = 0;
  composeWebgpuPlacements(rt, parent, turn(0.1), links, true);
  frame();
  assert.deepEqual(seeded(), [], 'held already: the GPU keeps the pose it accumulated');
  assert.deepEqual([...rt.compose!.ranksOf[0]], [0, 1]);
  composeWebgpuPlacements(rt, parent, turn(0.1), links.slice(1), true);
  assert.deepEqual([...rt.compose!.parentOf], [NONE, 0], 'root 0 left the set: the CPU writes it');
  composeWebgpuPlacements(rt, parent, turn(0.1), links, true);
  frame();
  assert.deepEqual(seeded(), [0], 'root 0 linked anew starts from its CPU pose again');
});

test('the temporal pyramid is dropped by a parent moved on the GPU, not by a link its rows wrote', () => {
  const { rt, rows } = session();
  const hiz = rt.run.temporalHizState as { pyramid?: unknown };
  const parent = {},
    links = [0, 1].map((index) => ({ rows, index, local: turn(0.4) }));
  hiz.pyramid = 'held';
  composeWebgpuPlacements(rt, parent, turn(0), links, true);
  assert.equal(hiz.pyramid, 'held', 'linked with its rows own write: the CPU write staled them');
  composeWebgpuPlacements(rt, parent, turn(0), [], false);
  assert.equal(hiz.pyramid, 'held', 'sent at the world it held');
  composeWebgpuPlacements(rt, parent, turn(0.1), [], false);
  assert.equal(hiz.pyramid, undefined, 'turned on the GPU alone');
});
