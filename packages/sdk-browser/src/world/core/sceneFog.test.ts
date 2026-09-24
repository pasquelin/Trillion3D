// `scene.fog` (#345): a fog set, or its colour written, is heard by the world, which writes it
// with the lights before the next frame, like exposure; the lighting reads its linear colour; a
// fog out of range is refused where it is set; a saved scene keeps it, height fog included.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { createWorldLink } from './worldLink.ts';
import { Scene } from './scene.ts';
import { sceneFogOf } from './sceneFog.ts';

const noLoad = () => Promise.reject(new Error('no model in this test'));

function wiredScene() {
  const scene = new Scene(noLoad);
  const calls = { relight: 0, invalidate: 0 };
  scene._link = createWorldLink({
    contents: {} as never,
    lights: {} as never,
    invalidate: () => calls.invalidate++,
    relight: () => calls.relight++,
    schedule: () => {},
  });
  return { scene, calls };
}

test('a fog set, cleared, or its colour written, relights the next frame', () => {
  const { scene, calls } = wiredScene();
  const color = new Color(0x8899aa);
  scene.fog = { color, near: 5, far: 50 };
  assert.equal(calls.relight, 1);
  color.setHex(0x223344);
  assert.equal(calls.relight, 2);
  scene.fog = null;
  assert.equal(calls.relight, 3);
  // The colour of a fog no longer set is no longer heard.
  color.setHex(0xffffff);
  assert.equal(calls.relight, 3);
});

test('the lighting reads the fog colour in linear components and the law as written', () => {
  const color = new Color().setRGB(0.25, 0.5, 0.75);
  assert.equal(sceneFogOf(null), undefined);
  assert.deepEqual(sceneFogOf({ color, near: 2, far: 9 }), {
    color: [0.25, 0.5, 0.75],
    near: 2,
    far: 9,
  });
  assert.deepEqual(sceneFogOf({ color, density: 0.1, heightFalloff: 0.2 }), {
    color: [0.25, 0.5, 0.75],
    density: 0.1,
    heightFalloff: 0.2,
  });
});

test('a fog out of range is refused where it is set, the fog in place kept', () => {
  const { scene } = wiredScene();
  const kept = { color: new Color(), density: 0.01 };
  scene.fog = kept;
  const refused = { code: 'INVALID_SCENE_ENVIRONMENT' };
  assert.throws(() => (scene.fog = { color: new Color(), near: 10, far: 10 }), refused);
  assert.throws(() => (scene.fog = { color: new Color(), density: -1 }), refused);
  assert.throws(() => (scene.fog = { color: new Color(), density: 1, heightFalloff: -1 }), refused);
  assert.equal(scene.fog, kept);
});

test('a saved scene keeps its fog, height fog included', async () => {
  const scene = new Scene(noLoad);
  scene.fog = {
    color: new Color().setRGB(0.1, 0.2, 0.3),
    density: 0.05,
    heightFalloff: 0.4,
    baseHeight: -2,
  };
  const saved = JSON.parse(JSON.stringify(scene.toJSON()));
  assert.deepEqual(saved.fog, {
    color: [0.1, 0.2, 0.3],
    density: 0.05,
    heightFalloff: 0.4,
    baseHeight: -2,
  });
  const again = new Scene(noLoad);
  await again.fromJSON(saved);
  assert.deepEqual(sceneFogOf(again.fog), saved.fog);
  assert.ok(again.fog?.color instanceof Color);
});
