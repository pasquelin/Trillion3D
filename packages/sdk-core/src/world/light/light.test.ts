/**
 * A light costs what it holds (#944): its kind, its colours, its target, its coefficients and its
 * numbers. The flag lives on the class; its colours and its target's place hear it only while it
 * is in a world, so the lights the engine builds for itself hold no listener.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Light } from './light.ts';
import { Group } from '../object/object3d.ts';
import { countingLink } from '../object/sceneLink.fixture.ts';

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
