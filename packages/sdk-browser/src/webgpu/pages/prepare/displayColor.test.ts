// S11: drawn apart from the display — dynamic resolution, the default —, the composition writes the
// display and nothing visible reads the render-size display colour (4 B/px) but the water's word,
// which borrows it. A scene without water makes none; one drawn at the display's size borrows the
// display's view, never its texture.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts';
import { runtime } from './targets.fixture.ts';
import { makeTargets, releaseTargets, targetsFit } from './targets.ts';
import { frameExtraBytes, frameTargetAllocation } from './targetAllocation.ts';
import { displayApart } from '../state/renderScale.ts';

/** The targets of a 64 × 32 display drawn at `renderWidth`, the scene with water or not. */
function made(renderWidth: number, water: boolean) {
  const { rt } = runtime();
  const gpu = fakeDevice({ limits: { maxTextureDimension2D: 8192 } });
  Object.assign(rt.gpu, { device: gpu.device });
  Object.assign(rt, {
    vis: { writesFeedback: true, writesEmissiveAo: true },
    capture: { capturing: false, captureAllocationBytes: 0 },
    blendState: { blendGpu: [], transmissive: water ? 1 : 0 },
  });
  const size = { width: 64, height: 32, renderWidth, renderHeight: renderWidth / 2, apart: true };
  const asked = frameTargetAllocation(rt, size);
  makeTargets(rt, gpu.device, size, asked);
  // The transmission's backdrop is charged beside the targets (`frameExtraBytes`); a scene without
  // it keeps two 1×1 stand-ins no one charges.
  const charged = gpu.textures.filter(
    ({ label, width }) => water || width > 1 || !/backdrop|water depth/.test(label ?? ''),
  );
  const bytes =
    charged.reduce((sum, texture) => sum + (textureBytesOf(texture) ?? 0), 0) +
    gpu.buffers.reduce((sum, buffer) => sum + buffer.size, 0);
  const labels = gpu.textures.map(({ label }) => label);
  return { rt, gpu, size, asked, bytes, labels, extra: frameExtraBytes(rt, size) };
}

test('apart without water: no display colour, and the bytes made are the bytes asked', () => {
  for (const renderWidth of [32, 64]) {
    const { rt, size, asked, bytes, labels, extra } = made(renderWidth, false);
    assert.ok(!labels.includes('Trillion3D display color'), `at ${renderWidth}`);
    assert.equal(rt.gpu.colorTexture, undefined);
    assert.equal(rt.gpu.colorView, undefined);
    assert.ok(rt.gpu.displayView && displayApart(rt.gpu), 'the display is apart');
    assert.equal(bytes, asked + extra, 'frameTargetAllocation follows');
    assert.equal(targetsFit(rt, size), true, 'and the targets fit: nothing is remade');
  }
});

test("water below the display's size has its own colour; at its size it borrows the display's view", () => {
  const below = made(32, true);
  assert.ok(below.labels.includes('Trillion3D display color'));
  assert.ok(below.rt.gpu.colorView && below.rt.gpu.colorView !== below.rt.gpu.displayView);
  assert.equal(below.bytes, below.asked + below.extra);
  const at = made(64, true);
  assert.ok(!at.labels.includes('Trillion3D display color'));
  assert.equal(at.rt.gpu.colorView, at.rt.gpu.displayView, 'the word borrows the display');
  assert.equal(at.rt.gpu.colorTexture, undefined, 'never the texture: the targets stay apart');
  assert.ok(displayApart(at.rt.gpu));
  assert.equal(at.bytes, at.asked + at.extra);
  for (const { rt, size } of [below, at]) assert.equal(targetsFit(rt, size), true);
  // A display colour asked where none is wanted, or none where one is: the targets are remade.
  Object.assign(below.rt.blendState, { transmissive: 0 });
  assert.equal(targetsFit(below.rt, below.size), false);
});

test('released, a borrowed view frees each texture once', () => {
  const { rt, gpu } = made(64, true);
  releaseTargets(rt);
  const display = gpu.destroyed.filter(({ label }) => label === 'Trillion3D display');
  assert.equal(display.length, 1);
  assert.equal(new Set(gpu.destroyed).size, gpu.destroyed.length, 'no texture destroyed twice');
});
