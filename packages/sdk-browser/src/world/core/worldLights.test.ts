import test from 'node:test';
import assert from 'node:assert/strict';
import { light } from '../../../../sdk-core/src/world/light/light.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts';
import { createWorldLights } from './worldLights.ts';

/** A drawn graph whose one surface wears `roughness`; empty when it declares none. */
const graph = (roughness?: number) => {
  const root = object.group();
  if (roughness !== undefined)
    root.add(new Mesh(new Geometry(), new Material('meshStandard', { roughness })));
  return root;
};

/** A light store keeping the whole record written under each id. */
const records = () => {
  const held = new Map<string, SceneLight>();
  return {
    held,
    addLight: (record: SceneLight) => void held.set(record.id, record),
    setLight: (id: string, patch: Partial<SceneLight>) =>
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
    api = records();
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
    lit = records(),
    display = { exposure: 1, toneMapping: 'aces' as const };
  day.sync(scene, lit, display, graph(0.7));
  const shrunk = lit.held.get('world-light-1')!.range!;
  assert.ok(shrunk < 500, 'a weak lamp authored far past the frame is shortened');
  assert.ok(shrunk > 0);

  const night = createWorldLights(),
    raised = records();
  night.sync(scene, raised, { exposure: 8, toneMapping: 'aces' }, graph(0.7));
  assert.ok(
    raised.held.get('world-light-1')!.range! > shrunk,
    'a raised exposure re-derives a longer reach, never past the author',
  );
  assert.ok(raised.held.get('world-light-1')!.range! <= 500);
});

test('a rough scene shows less of a distant lamp, and unknown roughness takes the floor', () => {
  const scene = object.group();
  scene.add(light.point({ intensity: 0.01, distance: 500 }));
  const reachAt = (roughness: number | undefined) => {
    const lights = createWorldLights(),
      api = records();
    lights.sync(scene, api, { exposure: 1, toneMapping: 'aces' }, graph(roughness));
    return api.held.get('world-light-1')!.range!;
  };
  assert.ok(reachAt(0.95) < reachAt(Number(ROUGHNESS_FLOOR)), 'a rough scene keeps a lamp closer');
  assert.equal(
    reachAt(undefined),
    reachAt(Number(ROUGHNESS_FLOOR)),
    'unknown roughness takes the floor',
  );
});
