import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { beginTaaFrame, convergeStillPhase, restartTaaOnLanding } from './frame.ts';
import { taaJitter } from './jitter.ts';
import { createTaaFrameState } from './frameState.ts';
import { createScaleControl } from '../frame/scaleControl.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { EngineCamera } from '../camera/world.ts';

const DISPLAY = [3456, 2234];

/** A view drawn under `'auto'`, its controller dropped below 1 by a 20 ms frame at 120 Hz. */
function runtime() {
  const scale = createScaleControl('auto');
  for (let frame = 0; frame < 4; frame++) scale.tick((frame * 1000) / 120);
  scale.observe(20, 1);
  const rt = {
    gpu: {
      temporal: { frame: createTaaFrameState(), checkpoint() {}, replay: () => false },
      temporalWanted: true,
      targetSize: [...DISPLAY],
      allocatedSize: [...DISPLAY],
      displaySize: DISPLAY,
      colorTexture: {},
      displayTexture: {},
    },
    vis: {},
    scale,
    run: { diagnostic: 'beauty', frame: 0, textureConverging: false },
    capture: { capturing: false },
  } as unknown as WebgpuPagesRuntime;
  return { rt, moving: scale.wanted() };
}

const cam = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0] } as unknown as EngineCamera;

// #1343: a still image over budget is drawn below the display too, as a moving one.
test('a moving and a quiet image draw at the controller, a convergence at its image', () => {
  const { rt, moving } = runtime();
  assert.ok(moving < 1);
  beginTaaFrame(rt, cam, false);
  assert.equal(rt.scale.drawn, moving);
  assert.ok(rt.gpu.targetSize[0] < DISPLAY[0], 'drawn below the display');
  assert.equal(rt.scale.steered, true, 'the moving image is what the controller measures');
  rt.run.textureConverging = true;
  beginTaaFrame(rt, cam, true);
  assert.equal(rt.scale.drawn, moving, 'the convergence remakes the moving image at its scale');
  assert.equal(rt.scale.steered, false, 'a convergence image is not measured');
  rt.run.textureConverging = false;
  beginTaaFrame(rt, cam, true);
  assert.equal(rt.scale.drawn, moving, 'the quiet image is drawn at the controller too');
  assert.deepEqual([rt.scale.steered, rt.scale.still], [true, true], 'and measured, as still');
  rt.capture.capturing = true;
  beginTaaFrame(rt, cam, false);
  assert.deepEqual([rt.scale.drawn, rt.gpu.targetSize], [1, DISPLAY], 'no accumulation, no scale');
});

// #1016: a capture after a moving camera converged at the moving image's scale and jitter, so it
// made resident what that image reads; the held image, drawn at the display over eight other
// phases, read slivers nothing had asked for. The convergence branch itself draws a capture's
// barrier at the still scale, one phase after another (`stillPhase`); another barrier replays.
test("a capture's barrier converges at the still image's scale, phase after phase", () => {
  const { rt, moving } = runtime();
  beginTaaFrame(rt, cam, false);
  const frame = rt.gpu.temporal!.frame;
  rt.run.textureConverging = true;
  beginTaaFrame(rt, cam, false);
  assert.equal(rt.scale.drawn, moving, 'a barrier that takes no picture replays the image');
  convergeStillPhase(rt, 0);
  beginTaaFrame(rt, cam, false);
  assert.equal(rt.scale.drawn, moving, "the still image's scale is the controller's (#1343)");
  const replayed = [...frame.jitter];
  for (let phase = 1; phase < frame.phases; phase++) {
    convergeStillPhase(rt, phase);
    beginTaaFrame(rt, cam, false);
    const expected = taaJitter(frame.sample + phase, new Float64Array(2), frame.phases);
    assert.deepEqual([...frame.jitter], [...expected], `phase ${phase}`);
    assert.notDeepEqual([...frame.jitter], replayed);
  }
  convergeStillPhase(rt, null);
  rt.run.textureConverging = false;
});

// #1016 review: a tile or a shadow page landing on a still frame mixed two residencies in one
// average, at a time the readback decided. The average restarts on it, from phase zero.
test('a landing on a still image restarts its average; nothing landed, or moving, keeps it', () => {
  const { rt } = runtime();
  const frame = rt.gpu.temporal!.frame;
  for (let image = 0; image < 3; image++) beginTaaFrame(rt, cam, true);
  assert.equal(frame.stillFrames, 3);
  restartTaaOnLanding(rt, 0);
  assert.equal(frame.stillFrames, 3, 'nothing landed');
  restartTaaOnLanding(rt, 2);
  assert.deepEqual([frame.stillFrames, frame.hasHistory], [0, false]);
  frame.sample = 5;
  beginTaaFrame(rt, cam, true);
  assert.deepEqual([frame.stillFrames, frame.sample], [1, 0], 'the next image restarts at phase 0');
  beginTaaFrame(rt, cam, false);
  restartTaaOnLanding(rt, 4);
  assert.equal(frame.stillFrames, 0, 'a moving image has no still average to restart');
});

// #1343: a still average is of one scale; the controller lowering it restarts the average.
test('a still image the controller lowers restarts its average at the new scale', () => {
  const { rt, moving } = runtime();
  const frame = rt.gpu.temporal!.frame;
  for (let image = 0; image < 3; image++) beginTaaFrame(rt, cam, true);
  assert.equal(frame.stillFrames, 3);
  beginTaaFrame(rt, cam, true);
  assert.equal(frame.stillFrames, 4, 'the same scale keeps the average');
  rt.scale.observe(40, moving);
  assert.ok(rt.scale.wanted() < moving, 'a still frame over budget lowers the scale');
  frame.sample = 3;
  beginTaaFrame(rt, cam, true);
  assert.deepEqual([frame.stillFrames, frame.sample, frame.hasHistory], [1, 0, false]);
  assert.equal(rt.scale.drawn, rt.scale.wanted());
});
