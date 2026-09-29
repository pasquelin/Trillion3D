// #816: the fallback draw paints the colour target; a frame drawn below the display presents a
// display colour of its own, which that draw never writes. The image is dropped and the targets
// remade at the display's size, rather than presenting the previous or a blank display colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDraws } from './encodeDraws.ts';
import { twoPlacesRuntime } from '../twoPlaces.fixture.ts';

test('the fallback draw over targets drawn below the display asks native ones and draws nothing', async () => {
  const { rt, dispose } = await twoPlacesRuntime();
  try {
    const device = rt.gpu.device!;
    rt.vis.visView = undefined;
    assert.ok(encodeDraws(rt, device, rt.run.gate.cam) > 0, 'at the display, the fallback draws');
    const display = { destroy: () => {} } as unknown as GPUTexture;
    Object.assign(rt.gpu, { displayTexture: display, targetSize: [16, 16] });
    assert.equal(encodeDraws(rt, device, rt.run.gate.cam), 0, 'nothing is drawn');
    assert.equal(rt.run.gpuDrawCalls, 0);
    assert.ok(rt.gpu.targetGrant, 'targets at the display are asked');
  } finally {
    dispose();
  }
});
