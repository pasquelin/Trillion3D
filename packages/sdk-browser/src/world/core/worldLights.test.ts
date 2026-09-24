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
