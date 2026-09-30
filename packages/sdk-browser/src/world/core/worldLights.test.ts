import test from 'node:test';
import assert from 'node:assert/strict';
import { light } from '../../../../sdk-core/src/world/light/light.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { createWorldLights } from './worldLights.ts';

/** A light store recording what is written into it. */
const store = () => {
  const held = new Set<string>();
  return {
    held,
    addLight: (record: { id: string }) => void held.add(record.id),
    setLight: () => {},
    removeLight: (id: string) => void held.delete(id),
  };
};

test('a light under a hidden group lights nothing, and lights again once shown', () => {
  const scene = object.group(),
    group = object.group();
  group.add(light.point({ intensity: 5 }), light.ambient({ intensity: 1 }));
  scene.add(group);
  const lights = createWorldLights(),
    api = store();
  assert.ok(lights.sync(scene, api));
  assert.equal(api.held.size, 1);
  group.visible = false;
  assert.equal(lights.sync(scene, api), undefined, 'the ambient gives nothing');
  assert.equal(api.held.size, 0, 'the lamp left the store');
  assert.equal(lights.held, 2, 'both are still held, so showing the group relights');
  group.visible = true;
  assert.ok(lights.sync(scene, api));
  assert.equal(api.held.size, 1);
});

/** The ranges the store receives, by light, from one sync of `lamps` in an empty group. */
const rangesOf = (lamps: ReturnType<typeof light.point>[]) => {
  const scene = object.group(),
    ranges: (number | undefined)[] = [];
  for (const lamp of lamps) scene.add(lamp);
  createWorldLights().sync(scene, {
    addLight: (record: { range?: number }) => void ranges.push(record.range),
    setLight: () => {},
    removeLight: () => {},
  });
  return ranges;
};

test('the store receives each lamp’s authored range as-is, however faint the lamp (#958)', () => {
  assert.deepEqual(rangesOf([]), [], 'an empty scene writes nothing');
  const random = Array.from({ length: 64 }, (_, i) => 10 ** (((i * 7919) % 97) / 8 - 6));
  const authored = [...random, Number.MIN_VALUE, 1e-300, 18, Number.MAX_VALUE, Infinity];
  const faint = (distance: number) => light.point({ intensity: 1e-9, distance });
  assert.deepEqual(rangesOf(authored.map(faint)), authored, 'no reach is cut below the author’s');
  const unset = rangesOf([0, -0, NaN, -Infinity].map(faint));
  assert.ok(unset.every((range) => range === unset[0] && range! > 0 && Number.isFinite(range)));
});
