import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import {
  beginTaaFrame,
  createTaaFrameState,
  dropTaaHistory,
  encodeTaaPass,
  taaRenderMatrix,
  taaSampledRank,
  taaSettled,
} from './frame.ts';
import { TAA_STILL_FRAMES } from './jitter.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { TaaInputs } from './temporalAntialiasing.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';

/** The strict minimum of an engine: the fake pass, its inputs, the camera and the revisions. */
function runtime() {
  const encoded: unknown[] = [];
  const output = { color: {}, share: {} };
  const flags = { flags: true } as unknown as GPUTextureView;
  const temporal = {
    uniform: {} as GPUBuffer,
    motion: {
      buffer: {} as GPUBuffer,
      moved: false,
      updates: [] as boolean[],
      resets: 0,
      update(_eye: ArrayLike<number>, scan: boolean) {
        this.updates.push(scan);
      },
      reset() {
        this.resets++;
      },
    },
    frame: createTaaFrameState(),
    inputs: {} as TaaInputs,
    checkpoint() {},
    replay: () => false,
    encode(_encoder: unknown, inputs: unknown) {
      encoded.push(inputs);
      return output;
    },
  };
  const rt = {
    gpu: { temporal, temporalWanted: true, targetSize: [64, 32], depthView: {}, hdrView: {} },
    vis: { visView: { ids: true }, pageTable: { pages: true } },
    run: { diagnostic: 'beauty', gpuDrawCalls: 0, frame: 0, gate: { revisions: { scene: 1 } } },
    capture: { capturing: false },
  } as unknown as WebgpuPagesRuntime;
  rt.gpu.surfaces = { views: () => [{}, {}, {}, flags] } as never;
  const { device, writes } = fakeDevice();
  const cam = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0] } as unknown as EngineCamera;
  const hdr = rt.gpu.hdrView!;
  /** A whole frame: input, render matrix, pass; returns the written uniform, or `null`. */
  const frame = (quiet: boolean) => {
    beginTaaFrame(rt, cam, quiet);
    taaRenderMatrix(rt, cam);
    const before = writes.length;
    encodeTaaPass(rt, device, {} as GPUCommandEncoder, cam, hdr);
    return writes.length > before ? (writes[writes.length - 1].data as Float32Array) : null;
  };
  return { rt, cam, temporal, encoded, frame, flags };
}

test("without accumulation this frame, the render matrix is the camera's and composition reads the lit image", () => {
  const { rt, cam, encoded, frame } = runtime();
  rt.capture.capturing = true;
  assert.equal(frame(false), null);
  assert.equal(taaRenderMatrix(rt, cam), cam.viewProjection);
  assert.equal(encoded.length, 0);
  rt.capture.capturing = false;
  rt.run.diagnostic = 'screen-error' as never;
  assert.equal(frame(false), null);
  assert.equal(taaRenderMatrix(rt, cam), cam.viewProjection);
  // With no pass rigged at all, the frame is held as before the batch.
  rt.gpu.temporal = undefined;
  assert.equal(taaSettled(rt), true);
});

test('an accumulated frame advances jitter, writes the uniform and returns the written target', () => {
  const { rt, cam, temporal, encoded, frame, flags } = runtime();
  let u = frame(false)!;
  assert.notEqual(
    taaRenderMatrix(rt, cam),
    cam.viewProjection,
    'the render matrix carries the jitter',
  );
  assert.equal(encoded.length, 1);
  // The surface flags the as-is share is resolved from, beside the colour.
  assert.equal((encoded[0] as TaaInputs).flags, flags);
  assert.equal(temporal.motion.resets, 1, 'the first frame has no history: poses are taken');
  // Without history, `params.y` is 0; the next frame has it, and nobody moved (`params.z`).
  assert.equal(u[37], 0);
  u = frame(false)!;
  assert.equal(u[37], 1);
  assert.equal(u[38], 0);
  assert.deepEqual(temporal.motion.updates, [false], 'unchanged scene: no pose comparison');
  assert.equal(temporal.frame.sample, 2);
  // The nine filter weights sum to one.
  let sum = 0;
  for (let k = 0; k < 9; k++) sum += u[40 + k];
  assert.ok(Math.abs(sum - 1) < 1e-5);
  // A scene change makes poses be compared, and a placement that moved is told to the pass.
  rt.run.gate.revisions.scene++;
  temporal.motion.moved = true;
  u = frame(false)!;
  assert.deepEqual(temporal.motion.updates, [false, true]);
  assert.equal(u[38], 1);
});

test('hold waits for a full cycle of still frames, averaged uniformly from a fixed phase', () => {
  const { rt, temporal, frame } = runtime();
  // Three moving frames: exponential accumulation at one eighth, jitter advances.
  for (let i = 0; i < 3; i++) frame(false);
  assert.equal(temporal.frame.sample, 3);
  assert.equal(Math.fround(frame(false)![36]), Math.fround(1 / 8));
  assert.equal(taaSettled(rt), false);
  // First still frame: history is dropped, jitter restarts from zero.
  let u = frame(true)!;
  assert.equal(u[37], 0, 'without history: the pass returns the filtered current image');
  assert.equal(temporal.frame.sample, 1, 'phase zero replayed');
  assert.equal(temporal.frame.stillFrames, 1);
  // The following weigh 1/k: the sixteenth gives the uniform average of sixteen frames.
  u = frame(true)!;
  assert.equal(u[37], 1);
  assert.equal(Math.fround(u[36]), Math.fround(1 / 2));
  for (let k = 3; k < TAA_STILL_FRAMES; k++) u = frame(true)!;
  assert.equal(Math.fround(u[36]), Math.fround(1 / (TAA_STILL_FRAMES - 1)));
  assert.equal(taaSettled(rt), false, 'one frame before the full cycle, nothing is held');
  u = frame(true)!;
  assert.equal(Math.fround(u[36]), Math.fround(1 / TAA_STILL_FRAMES));
  assert.equal(taaSettled(rt), true);
  // Something moves: the count restarts, history stays and mixes at one eighth.
  u = frame(false)!;
  assert.equal(temporal.frame.stillFrames, 0);
  assert.equal(u[37], 1);
  assert.equal(Math.fround(u[36]), Math.fround(1 / 8));
  assert.equal(taaSettled(rt), false);
  // Reallocated targets lose history and the count.
  for (let i = 0; i < TAA_STILL_FRAMES; i++) frame(true);
  assert.equal(taaSettled(rt), true);
  dropTaaHistory(rt);
  assert.equal(temporal.frame.hasHistory, false);
  assert.equal(taaSettled(rt), false);
});

// A convergence frame — the barrier that re-renders the same pose to show arrived tiles —
// replays the last ordinary frame: same jitter, same stillness, instead of accumulating once more.
test('a convergence frame replays the last ordinary frame instead of advancing jitter', () => {
  const { rt, temporal, frame } = runtime();
  let replayed = 0,
    checkpoints = 0;
  temporal.checkpoint = () => {
    checkpoints++;
  };
  temporal.replay = () => {
    replayed++;
    return true;
  };
  frame(false);
  assert.equal(checkpoints, 1, 'an ordinary frame remembers where it started');
  assert.equal(replayed, 0);
  rt.run.textureConverging = true;
  frame(false);
  assert.equal(replayed, 1, 'a convergence frame replays');
  assert.equal(checkpoints, 1, 'and remembers nothing new');
  // The replayed stillness is that of the reference frame, not the one the tiles disturbed.
  assert.equal(temporal.frame.stillFrames, 1);
});

// Lighting is sampled on a moving image accumulated on a history, and on no other.
test('the sampled rank: moving accumulated frames only, another each frame, replayed', () => {
  const { rt, temporal, frame } = runtime();
  assert.equal(taaSampledRank(rt), 0, 'before any frame, nothing is sampled');
  frame(false);
  assert.equal(taaSampledRank(rt), 0, 'the first moving frame has no history to average it');
  frame(false);
  const first = taaSampledRank(rt);
  assert.ok(first > 0, 'a moving frame on a history samples');
  rt.run.frame++;
  frame(false);
  const second = taaSampledRank(rt);
  assert.notEqual(second, first, 'the next moving frame draws elsewhere');
  frame(true);
  assert.equal(taaSampledRank(rt), 0, 'a still frame shades every light');
  // A convergence frame replays the rank of the moving frame it remakes.
  temporal.replay = () => ((temporal.frame.sampledRank = second), false);
  rt.run.textureConverging = true;
  frame(false);
  assert.equal(taaSampledRank(rt), second, 'a replayed frame draws the same lights');
  rt.run.textureConverging = false;
  rt.capture.capturing = true;
  frame(false);
  assert.equal(taaSampledRank(rt), 0, 'a capture does not accumulate: nothing is sampled');
});
