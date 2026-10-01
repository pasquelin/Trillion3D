/**
 * A light costs what it holds (#944): its kind, its colours, its target, its coefficients and its
 * numbers. The flag lives on the class; its colours and its target's place hear it only while it
 * is in a world, so the lights the engine builds for itself hold no listener.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Light, light } from './light.ts';
import { Group, Object3D } from '../object/object3d.ts';
import { countingLink } from '../object/sceneLink.fixture.ts';
import { near } from '../../math/near.fixture.ts';

test('a light holds its kind, colours, target, coefficients and numbers, nothing more', () => {
  const light = new Light('spot');
  const own = Object.keys(new Group());
  const added = Object.keys(light).filter((key) => !own.includes(key));
  assert.deepEqual(added.sort(), ['_values', 'color', 'groundColor', 'kind', 'sh', 'target']);
  assert.equal(light.isLight, true, 'the flag reads from the class');
});

test('a light hears its colours and its target only while it is in a world', () => {
  const light = new Light('directional');
  // The target's place already tells its own node: only the light's listener comes and goes.
  const own = light.target.position._onChange;
  const listeners = () => [light.color._onChange, light.groundColor._onChange];
  const held = () => light.target.position._onChange === own;
  assert.deepEqual([...listeners(), held()], [null, null, true], 'outside a world: none');
  const scene = new Group(),
    { link, heard } = countingLink();
  scene._link = link;
  scene.add(light);
  light.color.setRGB(1, 0, 0);
  light.groundColor.setRGB(0, 1, 0);
  light.target.position.x = 3;
  assert.equal(heard.filter((node) => node === light).length, 3, 'each write reaches the world');
  scene.remove(light);
  assert.deepEqual(listeners(), [null, null], 'left the world: none');
  scene.add(light);
  scene.remove(light);
  scene.add(light);
  const before = heard.length;
  light.color.setRGB(0, 0, 1);
  light.target.position.x = 4;
  assert.equal(heard.length, before + 2, 'relinked: each write heard once');
});

test('light factories preserve their kinds and explicit zero-valued parameters', () => {
  for (const [kind, create] of Object.entries(light)) {
    assert.equal(create().kind, kind);
    assert.equal(create({ castShadow: true }).castShadow, true);
    const zero = create({ position: [0, 0, 0], decay: 0, angle: 0, intensity: 0 });
    assert.equal(zero.decay, 0);
    assert.equal(zero.angle, 0);
    assert.equal(zero.intensity, 0);
    assert.deepEqual(zero.position.toArray(), [0, 0, 0]);
  }
});

test('cloning a light preserves values but owns independently editable coefficients and numbers', () => {
  const coefficients = Float64Array.from({ length: 27 }, (_, i) => i / 10);
  const source = new Light('spot', {
    color: [0.2, 0.4, 0.6],
    groundColor: [0.1, 0.3, 0.5],
    sh: coefficients,
    target: [4, 5, 6],
    decay: 1.5,
    intensity: 7,
    distance: 8,
    angle: 0.3,
    penumbra: 0.4,
    width: 2,
    height: 3,
    radius: 0.2,
  });
  coefficients[0] = 99;
  const clone = source.clone();
  assert.equal(clone.kind, 'spot');
  assert.deepEqual(
    clone.sh,
    Array.from({ length: 27 }, (_, i) => i / 10),
  );
  assert.notEqual(clone.sh, source.sh);
  assert.deepEqual(clone.color.toArray(), [0.2, 0.4, 0.6]);
  assert.deepEqual(clone.groundColor.toArray(), [0.1, 0.3, 0.5]);
  assert.deepEqual(clone.target.position.toArray(), [4, 5, 6]);
  assert.deepEqual(
    [
      clone.decay,
      clone.intensity,
      clone.distance,
      clone.angle,
      clone.penumbra,
      clone.width,
      clone.height,
      clone.radius,
    ],
    [1.5, 7, 8, 0.3, 0.4, 2, 3, 0.2],
  );
  clone.intensity = 20;
  clone.sh![1] = 30;
  clone.target.position.x = 40;
  assert.equal(source.intensity, 7);
  assert.equal(source.sh![1], 0.1);
  assert.equal(source.target.position.x, 4);
  assert.equal(clone.copy(new Light('point')).sh, null);
  assert.equal(clone.kind, 'spot');
});

test('copying an ordinary node preserves light-specific values while adopting its pose', () => {
  const lamp = new Light('point', { intensity: 4 });
  const source = new Object3D();
  source.position.set(3, 2, 1);
  assert.equal(lamp.copy(source), lamp);
  assert.deepEqual(lamp.position.toArray(), [3, 2, 1]);
  assert.equal(lamp.intensity, 4);
});

test('lookAt accepts numbers and vectors, turning the emitter and moving its target in world space', () => {
  for (const parented of [false, true]) {
    const lamp = new Light('rectArea', { position: [1, 2, 3] });
    if (parented) {
      const parent = new Group();
      parent.position.set(10, -5, 2);
      parent.rotation.z = Math.PI / 2;
      parent.scale.set(2, 2, 2);
      parent.add(lamp.target);
    }
    lamp.lookAt(4, 6, 3);
    near(lamp.target.getWorldPosition().toArray(), [4, 6, 3], 'numeric target');
    near(lamp.getWorldDirection().toArray(), [0.6, 0.8, 0], 'numeric facing');
    lamp.lookAt({ x: 1, y: 2, z: -2 });
    near(lamp.target.getWorldPosition().toArray(), [1, 2, -2], 'vector target');
    near(lamp.getWorldDirection().toArray(), [0, 0, -1], 'vector facing');
  }
});

test('needsUpdate publishes edited probe coefficients while remaining a write-only invalidation', () => {
  const lamp = new Light('probe', { sh: Array(27).fill(0) });
  lamp.needsUpdate = true;
  assert.equal(lamp.needsUpdate, false);
  const scene = new Group();
  const { link, heard } = countingLink();
  scene._link = link;
  scene.add(lamp);
  heard.length = 0;
  lamp.sh![3] = 2;
  lamp.needsUpdate = true;
  assert.deepEqual(heard, [lamp]);
  assert.equal(lamp.needsUpdate, false);
  scene.remove(lamp);
  heard.length = 0;
  lamp.needsUpdate = true;
  assert.deepEqual(heard, []);
});

test('copying a light includes independently owned children unless recursion is disabled', () => {
  const source = new Light('spot');
  const child = new Object3D();
  child.name = 'emitter housing';
  child.position.set(2, 3, 4);
  source.add(child);
  const copy = new Light('point').copy(source);
  assert.equal(copy.children.length, 1);
  assert.notEqual(copy.children[0], child);
  assert.equal(copy.children[0].name, 'emitter housing');
  assert.deepEqual(copy.children[0].position.toArray(), [2, 3, 4]);
  assert.equal(copy.children[0].parent, copy);
  assert.equal(child.parent, source);
  assert.equal(new Light('point').copy(source, false).children.length, 0);
});
