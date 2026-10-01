// #1345: a lamp's restored pages are grouped on every device. The group's fragment keeps its page's
// texels alone (`pageHolds`), so a device without clip distances draws the lamp group from the
// sun's unclipped entries; where the device has them, they only spare the overdraw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { shadowGroupDraws } from './groupDraws.ts';

test('a lamp group draws with and without clip distances, its fragment keeping its page', () => {
  for (const clips of [false, true]) {
    const { device } = fakeDevice({ features: clips ? ['clip-distances'] : [] }),
      none = {} as GPUBindGroupLayout;
    const draws = shadowGroupDraws(device, {} as never, none, none),
      lamp = draws.made(true).opaque as unknown as GPURenderPipelineDescriptor;
    assert.equal(lamp.vertex.entryPoint, clips ? 'shadow_group_lamp_vs' : 'shadow_group_vs');
    assert.equal(lamp.fragment!.entryPoint, 'shadow_group_fs', 'pageHolds discards past the page');
    assert.equal(draws.blended(true) === draws.blended(false), !clips, "unclipped: the sun's");
  }
});
