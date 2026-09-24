// #402: the play layer's dispose left every vehicle, pedestrian and mover it added in the scene.
import assert from 'node:assert/strict';
import test from 'node:test';
import { layout } from './protocol.ts';
import { DEFAULT_MODELS } from './specs.ts';
import type { Engine, Node3 } from './types.ts';
import { view } from './view.ts';

/** A scene node that only keeps its children. */
function node(): Node3 & { children: Node3[] } {
  const xyz = { x: 0, y: 0, z: 0, set: () => {} };
  const self = {
    position: xyz,
    quaternion: xyz,
    scale: xyz,
    visible: true,
    children: [] as Node3[],
    add: (...nodes: Node3[]) => self.children.push(...nodes),
    remove: (...nodes: Node3[]) =>
      (self.children = self.children.filter((n) => !nodes.includes(n))),
  };
  return self;
}

const engine = {
  geometry: { box: () => ({}), cylinder: () => ({}), sphere: () => ({}), cone: () => ({}) },
  material: { meshStandard: () => ({}) },
  object: { mesh: node, group: node },
  light: { spot: () => ({ ...node(), intensity: 0, target: node() }) },
} as unknown as Engine;

test('the view takes every object it added back out of the scene', () => {
  const scene = node();
  const limits = { radius: 100, traffic: 3, pedestrians: 4 };
  const built = view(engine, scene, DEFAULT_MODELS, layout(limits, 0), limits, [], []);
  assert.equal(scene.children.length, 2 + 3 + 4, 'the car, the plane, traffic and pedestrians');
  built.dispose();
  assert.deepEqual(scene.children, []);
});
