import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from './object3d.ts';
import type { SceneLink } from './sceneLink.ts';

function sameNodes(actual: readonly Object3D[], expected: readonly Object3D[]) {
  assert.equal(actual.length, expected.length);
  actual.forEach((node, index) => assert.ok(node === expected[index]));
}

class Linked extends Object3D {
  transitions: boolean[] = [];
  protected override linked(value: boolean) {
    this.transitions.push(value);
  }
}
function link() {
  const structure: Object3D[] = [],
    pose: Object3D[] = [],
    shadow: Object3D[] = [];
  const world: SceneLink = {
    structure: (node) => structure.push(node),
    pose: (node) => pose.push(node),
    shadow: (node) => shadow.push(node),
    content() {},
    posed() {},
  };
  return { world, structure, pose, shadow };
}

test('world attachment transitions only on entry and exit, including unlinked replacement', () => {
  const node = new Linked(),
    first = link(),
    second = link();
  node._link = null;
  assert.deepEqual(node.transitions, []);
  node._link = first.world;
  node._link = first.world;
  node._link = second.world;
  assert.deepEqual(node.transitions, [true]);
  node._link = null;
  node._link = null;
  assert.deepEqual(node.transitions, [true, false]);
});

test('visibility and shadow writes notify their owning world with distinct responsibilities', () => {
  const node = new Object3D(),
    events = link();
  node._link = events.world;
  node.visible = false;
  assert.equal(node.visible, false);
  sameNodes(events.pose, [node]);
  node.castShadow = true;
  node.castShadow = true;
  node.castShadow = false;
  sameNodes(events.shadow, [node, node]);
  node._link = { ...events.world, shadow: undefined };
  assert.doesNotThrow(() => {
    node.castShadow = true;
  });
});

test('reparenting tells both worlds and changes every descendant ownership', () => {
  const oldRoot = new Object3D(),
    root = new Object3D(),
    child = new Linked(),
    leaf = new Linked();
  const oldWorld = link(),
    world = link();
  oldRoot._link = oldWorld.world;
  root._link = world.world;
  child.add(leaf);
  oldRoot.add(child);
  oldWorld.structure.length = 0;
  root.add(child);
  sameNodes(oldWorld.structure, [oldRoot]);
  sameNodes(world.structure, [root]);
  assert.ok(child.parent === root);
  assert.ok(leaf._link === world.world);
  assert.deepEqual(leaf.transitions, [true, false, true]);
  root.remove(leaf);
  assert.ok(leaf.parent === child);
  assert.ok(leaf._link === world.world);
  root.clear();
  sameNodes(root.children, []);
  assert.ok(child.parent === null);
  assert.ok(leaf._link === null);
});

test('visible traversal skips hidden subtrees while regular traversal and copy keep them', () => {
  const root = new Object3D(),
    hidden = new Object3D(),
    leaf = new Object3D(),
    visible = new Object3D();
  root.add(hidden, visible);
  hidden.add(leaf);
  hidden.visible = false;
  const all: Object3D[] = [],
    drawn: Object3D[] = [];
  root.traverse((node) => all.push(node));
  root.traverseVisible((node) => drawn.push(node));
  sameNodes(all, [root, hidden, leaf, visible]);
  sameNodes(drawn, [root, visible]);
  root.visible = false;
  const none: Object3D[] = [];
  root.traverseVisible((node) => none.push(node));
  sameNodes(none, []);
  const copy = new Object3D().copy(root);
  assert.ok(copy !== root);
  assert.equal(copy.children.length, 2);
  assert.equal(copy.children[0].children.length, 1);
  assert.ok(copy.children[0] !== hidden);
  assert.equal(copy.visible, false);
  assert.ok(root.attach(root) === root);
  assert.ok(root.parent === null);
});

test('self parenting is a no-op and removing children also works before entering a world', () => {
  const node = new Object3D(),
    child = new Object3D(),
    events = link();
  node.add(child);
  assert.ok(node.remove(child) === node);
  assert.ok(child.parent === null);
  node._link = events.world;
  assert.ok(node.add(node) === node);
  assert.ok(node.attach(node) === node);
  assert.ok(node.parent === null);
  sameNodes(events.pose, []);
});

test('destroy invalidates handles for the whole detached subtree', () => {
  const root = new Object3D(),
    branch = new Object3D(),
    leaf = new Object3D();
  root.add(branch);
  branch.add(leaf);
  branch.destroy();
  assert.equal(root.children.length, 0);
  assert.throws(
    () => leaf.setScale(1, 1, 1),
    (error: any) => error.code === 'STALE_SCENE_NODE',
  );
  assert.throws(
    () => branch.clone(),
    (error: any) => error.code === 'STALE_SCENE_NODE',
  );
});
