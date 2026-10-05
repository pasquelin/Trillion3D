// The coloured transmission's caps (`encodeVsmRenderAndTransmission`): a first one the room cannot
// hold is never made, a capped one grows back once the room holds it, and capacities past the
// device are capped as a device limit, never asked of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { vsmTransmissionBytes, vsmTransmissionMostCaps } from '../../../../vsm/transmissionPass.ts';
import { shortTransmission } from './vsmTransmission.fixture.ts';

test('a first transmission the room cannot hold is never made, said once', () => {
  const a = shortTransmission((grown, held) => grown - held);
  a.held.destroy();
  a.vsm.transmission = undefined;
  const made = a.fake.buffers.length;
  a.box.limit = a.ledger.bytes + vsmTransmissionBytes(a.layout) - 1;
  for (let frame = 0; frame < 3; frame++) assert.equal(a.frame(), undefined);
  assert.equal(a.vsm.transmissionDenied, true);
  assert.equal(a.fake.buffers.length, made, 'nothing asked of the device');
  assert.equal(a.ledger.refusal, undefined);
  assert.equal(a.said.length, 1, 'said once');
});

test('a capped transmission grows back once the room holds it, asked again every ten frames', () => {
  const a = shortTransmission((grown, held) => grown - held - 1);
  assert.equal(a.frame(), a.held);
  assert.equal(a.held.capped, true);
  a.box.limit = 1e12;
  for (let k = 1; k < 10; k++) {
    a.run.frame = 1 + k;
    assert.equal(a.frame(), a.held, `frame ${a.run.frame}: not asked again yet`);
  }
  a.run.frame = 11;
  const grown = a.frame()!;
  assert.deepEqual(
    grown.caps,
    a.first,
    'its own capacities: what it wanted was dropped with the cap',
  );
  assert.equal(grown.capped, false);
  assert.equal(a.said.length, 1, 'the cap said once, the growth silent');
  assert.equal(a.ledger.refusal, undefined);
});

test('capacities the device’s largest texture cannot hold are capped, never made invalid', () => {
  const a = shortTransmission((grown, held) => grown - held + 1e9);
  const most = vsmTransmissionMostCaps(a.layout, a.fake.device.limits);
  a.held.wanted = { ...a.first, blocks: most.blocks + 1 };
  const textures = a.fake.textures.length;
  for (let frame = 0; frame < 3; frame++) {
    a.run.frame = 2 + frame;
    assert.equal(a.frame(), a.held, `frame ${a.run.frame} keeps it`);
  }
  assert.equal(a.held.capped, true);
  assert.equal(a.held.wanted, undefined, 'the maps wait for no growth');
  assert.equal(a.fake.textures.length, textures, 'no memory past the device asked of it');
  assert.equal(a.said.length, 1, 'said once');
  const [phase] = a.said[0] as [string];
  assert.equal(phase, 'shadow-transmission-bounded', 'a device limit, not a memory budget');
  assert.equal(a.invalidated(), 0, 'the cached slices keep their transmission');
  // Two blocks a texel row below the page headers; unknown limits are the portable ones.
  assert.equal(most.blocks, (16384 - 1) * 2);
  assert.equal(vsmTransmissionMostCaps(a.layout).blocks, (8192 - 1) * 2);
});
