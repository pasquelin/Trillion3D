import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../core/scene.ts';
import type { LoadedModel } from '../core/loadedModel.ts';
import { object, Object3D, Sprite } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { light } from '../../../../sdk-core/src/world/light/index.ts';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { helper } from '../helper/index.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/index.ts';

/** A scene whose `load` stands a plain node in for the compiled model at `url`, carrying one
 *  light from its file as a compiled model does. */
function sceneWithLoads(loaded: string[]) {
  return new Scene(async (url) => {
    loaded.push(url);
    const lamp = light.point({ intensity: 2 });
    const model = Object.assign(new Object3D(), {
      isLoadedModel: true,
      record: { manifestUrl: url },
      _fromFile: (node: Object3D) => node === lamp,
    });
    model.add(lamp);
    return model as unknown as LoadedModel;
  });
}

test('what a page placed under a loaded model is saved, what its file carried is not', async () => {
  const scene = sceneWithLoads([]);
  const model = await scene.load('https://example.test/model/manifest.json');
  const sign = object.mesh(geometry.box(1, 1, 1));
  sign.name = 'sign';
  model.add(sign);
  const saved = JSON.parse(JSON.stringify(scene.toJSON()));
  assert.deepEqual(
    saved.children[0].children.map((child: { name: string }) => child.name),
    ['sign'],
  );
  const again = sceneWithLoads([]);
  await again.fromJSON(saved);
  const [lamp, placed] = again.children[0].children;
  assert.equal((lamp as { isLight?: boolean }).isLight, true, 'the file light comes back once');
  assert.equal(placed.name, 'sign');
  assert.equal(again.children[0].children.length, 2);
});

test('a saved scene is read back into the same scene, models by address', async () => {
  const loads: string[] = [];
  const scene = sceneWithLoads(loads);
  const red = material.meshStandard({ color: 0xff0000, metalness: 0.5 });
  const group = object.group();
  group.name = 'crate';
  group.position.set(1, 2, 3);
  group.rotation.y = 0.5;
  const box = object.mesh(geometry.box(2, 1, 1), red),
    twin = object.mesh(geometry.torus(1, 0.25), red);
  box.userData = { tag: 'box' };
  group.add(box, twin);
  const lamp = light.spot({ color: 0xffeeaa, intensity: 4, distance: 9, castShadow: true });
  lamp.target.position.set(0, -1, 0);
  const model = await scene.load('https://example.test/model/manifest.json');
  model.position.set(0, 0, -5);
  scene.add(group, lamp, helper.grid(), helper.box(box.geometry.computeBoundingBox()));
  scene.background = new Color(0x223344);
  const camera = new Camera('perspective', { fov: 40 });
  camera.position.set(4, 5, 6);
  const saved = JSON.parse(JSON.stringify(scene.toJSON(camera)));
  assert.equal(saved.materials.length, 1, 'one material worn twice is stored once');
  assert.deepEqual(saved.geometries[0], { recipe: { type: 'box', args: [2, 1, 1, 1, 1, 1] } });
  assert.equal(saved.children.length, 3, 'the helper marks are not stored');

  const again = sceneWithLoads(loads),
    view = new Camera('perspective'),
    grid = helper.grid();
  again.add(object.group(), grid);
  await again.fromJSON(saved, view);
  assert.ok(grid.parent === again, 'the helper marks stay; the content is replaced');
  assert.deepEqual(again.toJSON(view), saved);
  assert.deepEqual(loads, [model.record.manifestUrl, model.record.manifestUrl]);
  const [a, b] = again.getObjectByName('crate')!.children as (typeof box)[];
  assert.equal(a.material, b.material, 'shared matter stays shared');
});

test('another format version is refused, and the scene is left as it was', async () => {
  const scene = sceneWithLoads([]);
  scene.add(object.group());
  const saved = { ...scene.toJSON(), formatVersion: 2 };
  await assert.rejects(scene.fromJSON(saved), { code: 'UNSUPPORTED_SCENE_FORMAT' });
  assert.equal(scene.children.length, 1);
});

test('a model that cannot be loaded leaves the scene as it was, late arrivals included', async () => {
  /** The slow load, awaited below so the check runs once its model has reached the scene. */
  let late: Promise<LoadedModel> | undefined;
  const load = async (url: string) => {
    if (url === 'broken') throw new Error('unreachable');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const model = new Object3D() as unknown as LoadedModel;
    scene.add(model);
    return model;
  };
  const scene = new Scene((url) => (url === 'late' ? (late = load(url)) : load(url)));
  const kept = object.group();
  scene.add(kept);
  const saved = scene.toJSON();
  const model = (url: string) => ({ ...saved.children[0], kind: 'model' as const, model: { url } });
  saved.children.push(model('late'), model('broken'));
  await assert.rejects(scene.fromJSON(saved), /unreachable/);
  await late;
  await new Promise(setImmediate);
  const left = scene.children;
  assert.ok(
    left.length === 1 && left[0] === kept,
    `${left.length} children, the kept node alone expected`,
  );
});

test('a shape written by hand comes back in its array type, normalized or not', async () => {
  const scene = sceneWithLoads([]);
  const colours = new BufferAttribute(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]), 3);
  colours.normalized = true;
  const shape = geometry.createBuffer({
    position: new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    color: colours,
  });
  scene.add(object.mesh(shape));
  await scene.fromJSON(JSON.parse(JSON.stringify(scene.toJSON())));
  const back = (scene.children[0] as ReturnType<typeof object.mesh>).geometry.attributes.color;
  assert.ok(back.array instanceof Uint8Array && back.normalized);
});

test('a parameter cleared to null is read back null, not an empty object', async () => {
  const cleared = material.meshStandard({ color: 0x00ff00 });
  cleared.map = null;
  const scene = sceneWithLoads([]);
  const box = object.mesh(geometry.box(1, 1, 1), cleared);
  scene.add(box);
  const saved = JSON.parse(JSON.stringify(scene.toJSON()));
  const again = sceneWithLoads([]);
  await again.fromJSON(saved);
  assert.equal((again.children[0] as typeof box).material.map, null);
});

test('a saved file with no background key is read back with no background, not refused', async () => {
  const scene = sceneWithLoads([]);
  scene.add(object.group());
  const saved = JSON.parse(JSON.stringify(scene.toJSON()));
  delete saved.background;
  scene.background = new Color(0xff0000);
  await scene.fromJSON(saved);
  assert.equal(scene.background, null);
});

test('two scenes read at once are read one after the other, never merged', async () => {
  const scene = sceneWithLoads([]);
  const saved = (url: string) => {
    const one = sceneWithLoads([]);
    one.add(Object.assign(new Object3D(), { isLoadedModel: true, record: { manifestUrl: url } }));
    return JSON.parse(JSON.stringify(one.toJSON()));
  };
  await Promise.all([scene.fromJSON(saved('first')), scene.fromJSON(saved('second'))]);
  const urls = scene.children.map(
    (child) => (child as { record?: { manifestUrl: string } }).record,
  );
  assert.deepEqual(urls, [{ manifestUrl: 'second' }], 'the second scene alone');
});

// #364: a sprite comes back a sprite, its centre and its material's turn kept.
test('a saved sprite is read back a sprite, with its centre and its turn', async () => {
  const scene = sceneWithLoads([]);
  const marker = object.sprite(material.sprite({ rotation: 0.6, sizeAttenuation: false }));
  marker.center.set(0.5, 0);
  scene.add(marker);
  const saved = JSON.parse(JSON.stringify(scene.toJSON()));
  const again = sceneWithLoads([]);
  await again.fromJSON(saved);
  const [back] = again.children as (typeof marker)[];
  assert.ok(back instanceof Sprite);
  assert.deepEqual([back.center.x, back.center.y], [0.5, 0]);
  assert.equal((back.material as Material).rotation, 0.6);
  assert.deepEqual(again.toJSON(), saved);
});
