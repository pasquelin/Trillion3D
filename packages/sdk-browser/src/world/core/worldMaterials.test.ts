import test from 'node:test';
import assert from 'node:assert/strict';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts';
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

// #346: the blending mode decides the pass and the pipeline, so writing it opens the session again
// on a new entry; an additive surface is blended even when `transparent` is left false.
test('a blending written at runtime is a new entry, and an additive one is never repainted', () => {
  const table = createWorldMaterials();
  const spark = material.meshBasic({ color: 0xff8800 });
  const plain = table.entryOf(spark);
  spark.blending = 'additive';
  const glow = table.entryOf(spark);
  assert.notEqual(glow, plain, 'the mode is not a value: copied on write');
  assert.equal(glow.material.blending, 'additive');
  spark.color.set(0x00ff00);
  assert.notEqual(table.entryOf(spark), glow, 'an additive surface is laid out at opening');
  assert.deepEqual(table.takeRepainted(), []);
});

// #360, #361: a map's sampling or placement written after the entry was made repaints the entry,
// whose host texture the repaint then writes in place; a new vector for the offset is heard like
// the one it replaced. Neither moves the texture's version: nothing is sent again.
test('a map’s sampling or placement repaints its entry, a new offset vector heard too', () => {
  const table = createWorldMaterials();
  const map = new Texture({ width: 2, height: 2 });
  const paint = material.meshStandard({ map });
  const entry = table.entryOf(paint);
  const writes: [() => unknown, 'sampling' | 'placement'][] = [
    [() => map.offset.set(0.5, 0), 'placement'],
    [() => (map.rotation = 1), 'placement'],
    [() => (map.wrapS = 'repeat'), 'sampling'],
    [() => (map.minFilter = 'nearest'), 'sampling'],
    [() => (map.offset = new Vector2(0.25, 0)), 'placement'],
    [() => map.offset.set(0.75, 0), 'placement'],
  ];
  for (const [write, counter] of writes) {
    const count = map[counter],
      version = map.version;
    write();
    assert.equal(map[counter], count + 1, `${write}: counted as ${counter}`);
    assert.equal(map.version, version, 'no picture to send');
    assert.equal(table.entryOf(paint), entry, 'the entry kept');
    assert.deepEqual(table.takeRepainted(), [entry], `${write}: repainted`);
  }
});

// #402: a replaced vector kept its listener, so a write to it still repainted the texture.
test('a replaced placement vector is let go, and writing the same one back moves nothing', () => {
  const map = new Texture({ width: 2, height: 2 });
  const old = map.repeat;
  const next = new Vector2(2, 2);
  map.repeat = next;
  const placement = map.placement;
  old.set(8, 8);
  assert.equal(map.placement, placement, 'the old vector is no longer heard');
  map.repeat = next;
  assert.equal(map.placement, placement, 'the same vector: no write');
  map.repeat.set(3, 3);
  assert.equal(map.placement, placement + 1, 'the new vector is');
});
