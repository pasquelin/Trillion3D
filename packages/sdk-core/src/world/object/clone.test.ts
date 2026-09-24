import test from 'node:test';
import assert from 'node:assert/strict';
import { object, Object3D } from './index.ts';
import { geometry } from '../geometry/index.ts';
import { material } from '../material/index.ts';
import { light } from '../light/index.ts';

test('a clone keeps every field a saved scene keeps, and shares nothing', () => {
  const group = object.group();
  group.name = 'crate';
  group.position.set(1, 2, 3);
  group.rotation.y = 2.7;
  group.userData = { tag: 'crate' };
  const box = object.mesh(geometry.box(2, 1, 1), material.meshStandard({ color: 0xff0000 }));
  box.renderOrder = 4;
  box.castShadow = true;
  const dots = object.points(geometry.sphere(1));
  const lamp = light.spot({
    intensity: 4,
    distance: 9,
    angle: 0.4,
    penumbra: 0.3,
    target: [0, -2, 0],
  });
  lamp.visible = false;
  // A node built elsewhere — a loaded model — is not copied.
  const model = Object.assign(new (class extends Object3D {})(), { isLoadedModel: true });
  group.add(box, dots, lamp, model);

  const copy = object.clone(group)!;
  assert.equal(copy.name, 'crate');
  assert.deepEqual(copy.position.toArray(), [1, 2, 3]);
  assert.equal(copy.rotation.y, 2.7);
  assert.deepEqual(copy.userData, { tag: 'crate' });
  assert.notEqual(copy.userData, group.userData);
  assert.equal(copy.children.length, 3, 'the loaded model is left out');
  const [box2, dots2, lamp2] = copy.children as [typeof box, typeof dots, typeof lamp];
  assert.equal(box2.renderOrder, 4);
  assert.equal(box2.castShadow, true);
  assert.notEqual(box2.material, box.material);
  assert.notEqual(box2.geometry, box.geometry);
  assert.deepEqual(
    box2.geometry.recipe,
    box.geometry.recipe,
    'a copied shape still saves by recipe',
  );
  assert.equal(dots2.primitive, 'points');
  assert.deepEqual(lamp2._values, lamp._values);
  assert.equal(lamp2.visible, false);
  assert.deepEqual(lamp2.target.position.toArray(), [0, -2, 0]);
  (box2.material as { color: { setHex(hex: number): void } }).color.setHex(0x00ff00);
  assert.equal((box.material as { color: { getHex(): number } }).color.getHex(), 0xff0000);
  assert.equal(object.clone(model), null);
});
