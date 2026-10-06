// A transmission frame that changes nothing makes no bind group and writes no buffer: its draw
// groups are the opaque raster's mechanism (`bound`, `vsmPerFrameSet`) and its parameters, views
// and frame words go up where they changed (`vsmWriteChanged`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createVsmResources } from './resources.ts';
import { createVsmTransmission, encodeVsmTransmission } from './transmissionPass.ts';
import { recordingRaster } from './recordingRaster.fixture.ts';

function setup() {
  const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } });
  const { device } = fake;
  const res = createVsmResources(device, { fullMapCapacity: 127, poolPages: 256 });
  const trans = createVsmTransmission(device, res.layout);
  const { encoder, scene, lights } = recordingRaster(device, 4);
  const frame = (stamp: number) => {
    const groups = fake.bindGroups.length,
      writes = fake.writes.length;
    const drawn = encodeVsmTransmission(
      encoder,
      res,
      trans,
      { device, lights, stamp, rowFirst: 0, rowEnd: 4, used: 4 },
      scene,
    );
    res.swapFrames();
    return { drawn, groups: fake.bindGroups.length - groups, writes: fake.writes.length - writes };
  };
  return { fake, frame, scene };
}

test('a second identical frame makes no bind group and writes nothing', () => {
  const { frame } = setup();
  const first = frame(1);
  assert.ok(first.drawn, 'the blended rows are drawn');
  assert.ok(first.groups > 0 && first.writes > 0, 'the first frame makes and writes');
  frame(1); // the other frame set's tables
  const still = frame(1);
  assert.deepEqual([still.groups, still.writes], [0, 0]);
});

test('a new stamp writes the frame words alone, a moved scene buffer only the groups it feeds', () => {
  const { frame, scene, fake } = setup();
  frame(1);
  frame(1);
  frame(1);
  const stamped = frame(2);
  assert.deepEqual([stamped.groups, stamped.writes], [0, 1]);
  const other = fake.device.createBuffer({ size: 16, usage: 0 });
  scene.spheres = other;
  assert.ok(frame(2).groups > 0, 'the groups over the moved buffer are made again');
});
