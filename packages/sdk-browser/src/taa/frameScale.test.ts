import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { beginTaaFrame, convergeAtStillScale } from './frame.ts';
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

// #832: a still image is today's, drawn at the display; a moving one at the controller's scale.
test('a moving image draws at the controller, a quiet one at 1, a convergence at its image', () => {
  const { rt, moving } = runtime();
  assert.ok(moving < 1);
  beginTaaFrame(rt, cam, false);
  assert.equal(rt.scale.drawn, moving);
  assert.ok(rt.gpu.targetSize[0] < DISPLAY[0], 'drawn below the display');
  assert.equal(rt.scale.steered, true, 'the moving image is what the controller measures');
  rt.run.textureConverging = true;
  beginTaaFrame(rt, cam, true);
  assert.equal(rt.scale.drawn, moving, 'the convergence remakes the moving image at its scale');
  rt.run.textureConverging = false;
  beginTaaFrame(rt, cam, true);
  assert.equal(rt.scale.drawn, 1);
  assert.deepEqual(rt.gpu.targetSize, DISPLAY, 'the quiet image is drawn at the display');
  assert.equal(rt.scale.steered, false, 'a still image, which shades every light, is not measured');
  rt.capture.capturing = true;
  beginTaaFrame(rt, cam, false);
  assert.deepEqual([rt.scale.drawn, rt.gpu.targetSize], [1, DISPLAY], 'no accumulation, no scale');
});

// #1016: a capture after a moving camera converged at the moving image's scale, so it made
// resident what that scale reads; the held image, drawn at the display, read slivers nothing had
// asked for, and the A/A kept what each run's path had left (1-3 px on sponza's `generale`).
test("a capture's barrier converges at the scale its still image is drawn at", () => {
  const { rt, moving } = runtime();
  beginTaaFrame(rt, cam, false);
  assert.equal(rt.scale.drawn, moving);
  convergeAtStillScale(rt);
  rt.run.textureConverging = true;
  beginTaaFrame(rt, cam, true);
  assert.equal(rt.scale.drawn, 1);
  assert.deepEqual(rt.gpu.targetSize, DISPLAY, 'the barrier reads what the held image will read');
});
