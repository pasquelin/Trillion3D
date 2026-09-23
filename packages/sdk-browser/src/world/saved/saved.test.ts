import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../core/scene.ts';
import type { LoadedModel } from '../core/loadedModel.ts';
import { object, Object3D } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { light } from '../../../../sdk-core/src/world/light/index.ts';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { helper } from '../helper/index.ts';

/** A scene whose `load` stands a plain node in for the compiled model at `url`. */
function sceneWithLoads(loaded: string[]) {
  return new Scene(async (url) => {
    loaded.push(url);
    return Object.assign(new Object3D(), {
      isLoadedModel: true,
      record: { manifestUrl: url },
    }) as unknown as LoadedModel;
  });
}

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
