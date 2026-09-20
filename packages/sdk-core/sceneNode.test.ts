import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_MODEL_VERSION, type SceneNode } from './sceneNode.ts';
import { createSceneRoot } from './sceneRoot.ts';

const hasCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

test('scene nodes keep stable ids, visibility, hierarchy and transforms', () => {
  const root = createSceneRoot({ id: 'scene' });
  const parent = root.createNode({ id: 'parent', visible: false });
  const child = root.createNode({ id: 'child' });
  root.add(parent);
  parent.add(child);
  child.setPosition(1, 2, 3).setScale(2, 3, 4);
  assert.equal(root.version, SCENE_MODEL_VERSION);
  assert.equal(root.node('child'), child);
  assert.equal(child.parent, parent);
  assert.deepEqual(parent.children, [child]);
  assert.equal(parent.visible, false);
  assert.equal(child.id, 'child');
});

test('remove and clear detach live children, reparent rejects cycles and other roots', () => {
  const root = createSceneRoot();
  const a = root.createNode({ id: 'a' });
  const b = root.createNode({ id: 'b' });
  root.add(a);
  a.add(b);
  assert.throws(() => b.add(a), /TRANSFORM_CYCLE|cycle/);
  assert.equal(a.parent, root);
  assert.equal(b.parent, a);
  assert.deepEqual(a.children, [b]);
  assert.throws(() => a.add(createSceneRoot().createNode()), hasCode('SCENE_ROOT_MISMATCH'));
  a.remove(b);
  assert.equal(b.parent, null);
  root.add(b).clear();
  assert.equal(a.parent, null);
  assert.equal(b.parent, null);
});

test('children cannot be mutated through the public JavaScript value', () => {
  const root = createSceneRoot();
  const parent = root.createNode({ id: 'parent' });
  const child = root.createNode({ id: 'child' });
  parent.add(child);
  const exposed = parent.children as SceneNode[];
  assert.throws(() => exposed.pop(), TypeError);
  assert.deepEqual(parent.children, [child]);
  assert.equal(child.parent, parent);
});

test('clone and copy preserve values and optionally reproduce independent descendants', () => {
  const root = createSceneRoot();
  const source = root.createNode({ id: 'source', visible: false }).setScale(2, 3, 4);
  source.add(root.createNode({ id: 'leaf' }).setPosition(1, 2, 3));
  const shallow = source.clone(false, { id: 'shallow' });
  const deep = root.createNode({ id: 'deep' }).copy(source, true);
  assert.equal(shallow.children.length, 0);
  assert.equal(deep.visible, false);
  assert.equal(deep.children.length, 1);
  assert.notEqual(deep.children[0], source.children[0]);
  source.updateWorldMatrix(true, true);
  deep.updateWorldMatrix(true, true);
  assert.deepEqual([...deep.worldMatrix], [...source.worldMatrix]);
  deep.children[0].setScale(9, 8, 7).updateWorldMatrix();
  assert.notDeepEqual([...deep.children[0].worldMatrix], [...source.children[0].worldMatrix]);
});

test('recursive copy refuses ancestor into descendant before changing either node', () => {
  const root = createSceneRoot();
  const source = root.createNode({ id: 'source', visible: false }).setScale(2, 3, 4);
  const target = root.createNode({ id: 'target' }).setPosition(5, 6, 7);
  source.add(target);
  const before = [...target.localMatrix];
  assert.throws(() => target.copy(source, true), hasCode('SCENE_COPY_OVERLAP'));
  assert.equal(target.visible, true);
  assert.deepEqual([...target.localMatrix], before);
  assert.equal(target.parent, source);
  assert.deepEqual(source.children, [target]);
  assert.equal(target.children.length, 0);
});

test('duplicate ids and destroyed handles fail with named errors', () => {
  const root = createSceneRoot();
  const branch = root.createNode({ id: 'branch' });
  const leaf = root.createNode({ id: 'leaf' });
  branch.add(leaf);
  root.add(branch);
  assert.throws(() => root.createNode({ id: 'leaf' }), hasCode('DUPLICATE_SCENE_NODE_ID'));
  branch.destroy();
  assert.equal(root.node('branch'), undefined);
  assert.equal(root.node('leaf'), undefined);
  assert.throws(() => leaf.setScale(1, 1, 1), hasCode('STALE_SCENE_NODE'));
  assert.throws(() => leaf.clone(), hasCode('STALE_SCENE_NODE'));
  assert.throws(() => {
    leaf.visible = true;
  }, hasCode('STALE_SCENE_NODE'));
  assert.throws(() => root.destroy(), hasCode('SCENE_ROOT_DESTROY'));
  const live = root.createNode({ id: 'live' });
  assert.throws(() => live.add(root), hasCode('SCENE_ROOT_PARENT'));
  assert.equal(root.parent, null);
});

test('generated ids skip explicit identifiers and invalid ids are rejected', () => {
  const root = createSceneRoot({ id: 'node-1' });
  const explicit = root.createNode({ id: 'node-2' });
  const generated = root.createNode();
  assert.equal(explicit.id, 'node-2');
  assert.equal(generated.id, 'node-3');
  assert.throws(() => root.createNode({ id: '' }), hasCode('INVALID_SCENE_NODE_ID'));
  assert.throws(
    () => root.createNode({ visible: 'yes' as unknown as boolean }),
    hasCode('INVALID_SCENE_NODE_VISIBILITY'),
  );
});

test('invalid creation visibility does not consume an id or transform slot', () => {
  const root = createSceneRoot({ id: 'root' });
  assert.throws(
    () => root.createNode({ visible: 'yes' as unknown as boolean }),
    hasCode('INVALID_SCENE_NODE_VISIBILITY'),
  );
  const afterFailure = root.createNode();
  assert.equal(afterFailure.id, 'node-1');
  assert.equal(afterFailure.index, 1);
});

test('visible rejects non-boolean values without changing node state', () => {
  const afterFailure = createSceneRoot().createNode();
  assert.throws(() => {
    afterFailure.visible = 'yes' as unknown as boolean;
  }, hasCode('INVALID_SCENE_NODE_VISIBILITY'));
  assert.equal(afterFailure.visible, true);
});
