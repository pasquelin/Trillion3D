import test from 'node:test';
import assert from 'node:assert/strict';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { createWorldMaterials } from './worldMaterials.ts';

// #335: a material written every frame on a value — a pulsing lamp, a colour picker — keeps its
// entry, so its wearers keep their batch and the session is never opened again for it.
test('600 frames of a live emissive intensity repaint one entry in place', () => {
  const table = createWorldMaterials();
  const lamp = material.meshStandard({ color: 0xffffff, emissive: 0xffaa00 });
  const entry = table.entryOf(lamp);
  for (let frame = 0; frame < 600; frame++) {
    lamp.emissiveIntensity = 1.5 + Math.sin(frame);
    assert.equal(table.entryOf(lamp), entry, `frame ${frame} keeps the entry`);
    assert.deepEqual(table.takeRepainted(), [entry]);
    assert.equal(entry.material.emissiveIntensity, lamp.emissiveIntensity, 'the value follows');
  }
  lamp.color.set(0x00ff00);
  table.entryOf(lamp);
  assert.deepEqual(entry.material.color.toArray(), lamp.color.toArray());
});

test('a shared, blended or restructured entry is copied on write, never repainted', () => {
  const table = createWorldMaterials();
  const a = material.meshStandard(),
    b = material.meshStandard();
  const shared = table.entryOf(a);
  assert.equal(table.entryOf(b), shared, 'identical parameters fold');
  a.roughness = 0.2;
  const own = table.entryOf(a);
  assert.notEqual(own, shared, 'the other wearer keeps what it saw');
  assert.equal(shared.material.roughness, 1);
  a.roughness = 0.3;
  assert.equal(table.entryOf(a), own, 'alone now, the entry is repainted');
  a.side = 'double';
  assert.notEqual(table.entryOf(a), own, 'a raster field is not a value');
  const glass = material.meshStandard({ transparent: true, opacity: 0.5 });
  const pane = table.entryOf(glass);
  glass.color.set(0xff0000);
  assert.notEqual(table.entryOf(glass), pane, 'a blended surface is laid out at opening');
  assert.equal(table.takeRepainted().length, 1);
});
