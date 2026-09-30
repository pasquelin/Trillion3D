import test from 'node:test';
import assert from 'node:assert/strict';
import { light } from '../../../../sdk-core/src/world/light/light.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts';
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

/** A light store keeping the whole record written under each id. */
const records = () => {
  const held = new Map<string, SceneLight>();
  return {
    held,
    addLight: (record: SceneLight) => void held.set(record.id, record),
    setLight: (id: string, patch: Partial<Omit<SceneLight, 'id'>>) =>
      void held.set(id, { ...held.get(id), ...patch } as SceneLight),
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

test('the authored range is the cap, and the frame’s perceptibility only shortens it', () => {
  const scene = object.group();
  scene.add(light.point({ intensity: 0.01, distance: 500 }));
  const bare = createWorldLights(),
    kept = records();
  bare.sync(scene, kept);
  assert.equal(kept.held.get('world-light-1')!.range, 500, 'no display: the authored range stands');

  const day = createWorldLights(),
    lit = records();
  day.sync(scene, lit, { exposure: 1, toneMapping: 'aces' });
  const shrunk = lit.held.get('world-light-1')!.range!;
  assert.ok(shrunk < 500, 'a weak lamp authored far past the frame is shortened');
  assert.ok(shrunk > 0);

  const night = createWorldLights(),
    raised = records();
  night.sync(scene, raised, { exposure: 8, toneMapping: 'aces' });
  assert.ok(
    raised.held.get('world-light-1')!.range! > shrunk,
    'a raised exposure re-derives a longer reach, never past the author',
  );
  assert.ok(raised.held.get('world-light-1')!.range! <= 500);
});
