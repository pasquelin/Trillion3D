// #984 (audit CPU-22): the draw brings world matrices up to date on the subtrees that changed
// alone, and they are develop's full pass, bit for bit, on random graphs and random edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChangedSubtrees } from './changedSubtrees.ts';
import { createDrawLists } from './drawLists.ts';
import { Scene } from '../../world/core/scene.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { Group, type Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { setHostPose } from '../../host/pageObjects.ts';
import type { HostMesh } from '../../host/resources.ts';
import { pick as pickOf, seeded } from '../../host/world/randomTree.fixture.ts';
import { HOSTILE_FLOATS } from '../../../../../tests/kit/assert/hostile.ts';

const EDGES = [...HOSTILE_FLOATS, 1e308, -1e308, 1, -2.5, 0.75];

/** True when `node` hangs under `top`, or is it. */
function within(node: Object3D, top: Object3D) {
  for (let at: Object3D | null = node; at; at = at.parent) if (at === top) return true;
  return false;
}

/** A random graph and the edits a page or the engine makes to it, each told through the link. */
function graph(seed: number, size: number) {
  const rnd = seeded(seed);
  const pick = <T>(list: readonly T[]) => pickOf(rnd, list);
  const value = () => pick(EDGES);
  const scene = new Scene(),
    nodes: Object3D[] = [],
    aside = new Group();
  // One graph in five starts from a root that does not update itself: its rule reaches less.
  if (seed % 5 === 0) scene.matrixAutoUpdate = false;
  const make = () => {
    const node = rnd() < 0.3 ? new Group() : new Mesh();
    node.position.set(value(), value(), value());
    // A page mesh: its matrix written in place, never recomposed.
    if (rnd() < 0.25) node.matrixAutoUpdate = false;
    nodes.push(node);
    return node;
  };
  const placed = () => [scene, ...nodes.filter((node) => within(node, scene))];
  const members = () => nodes.filter((node) => within(node, scene));
  // Every node made so far hangs under the scene: no filter while it is built.
  for (let i = 0; i < size; i++) pick([scene, ...nodes]).add(make());
  const matrix = () => Array.from({ length: 16 }, value);
  const edits: Record<string, () => void> = {
    add: () => pick(placed()).add(make()),
    remove: () => pick(members())?.removeFromParent(),
    reparent: () => {
      const node = pick(members());
      if (node) pick(placed().filter((n) => !within(n, node))).add(node);
    },
    detach: () => pick(members()) && aside.add(pick(members())),
    move: () => pick([...nodes, scene]).position.set(value(), value(), value()),
    turn: () => pick(nodes)?.quaternion.set(value(), value(), value(), value()),
    stretch: () => pick(nodes)?.scale.set(value(), value(), value()),
    look: () => pick(nodes)?.lookAt(value(), value(), value()),
    written: () => {
      const node = pick(nodes);
      if (node) setHostPose(node as HostMesh, { elements: matrix() });
    },
    // The physics' batch: poses written straight into the tree, told once through the root.
    posed: () => {
      const batch = [pick(nodes), pick(nodes)].filter(Boolean);
      for (const node of batch) node.setPosition(value(), value(), value());
      scene._link?.posed(batch);
    },
  };
  return { scene, nodes, edits, kinds: Object.keys(edits), pick };
}

/** Every world matrix under `scene`, in graph order, as bits: `NaN` and `-0` compared too. */
function worlds(scene: Object3D) {
  const bits: string[] = [];
  scene.traverse((node) =>
    bits.push(
      Array.from(node.matrixWorld.elements, (n) => (Object.is(n, -0) ? '-0' : String(n))).join(),
    ),
  );
  return bits;
}

/** Two twins of one seed, one drawn by the lists' pass and one by develop's full pass, compared
 *  after each of `steps` random edits; how many edits of each kind changed a world matrix. */
function replay(seed: number, size: number, steps: number) {
  const kept = graph(seed, size),
    developed = graph(seed, size);
  const lists = createDrawLists(kept.scene, []);
  const changed: Record<string, number> = {};
  let before: string[] = [];
  for (let step = 0; step <= steps; step++) {
    const kind = step ? kept.pick(kept.kinds) : '';
    if (kind) {
      developed.pick(kept.kinds); // the twin draws the same numbers
      kept.edits[kind]();
      developed.edits[kind]();
    }
    lists.refresh();
    developed.scene.updateMatrixWorld();
    const want = worlds(developed.scene);
    assert.deepEqual(worlds(kept.scene), want, `${kind} (seed ${seed}, step ${step})`);
    if (kind && want.join() !== before.join()) changed[kind] = (changed[kind] ?? 0) + 1;
    before = want;
  }
  lists.dispose();
  return { changed, kinds: kept.kinds };
}

test('random graphs and 10 000 random edits keep develop world matrices', () => {
  const changed: Record<string, number> = {};
  let kinds: string[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const run = replay(seed, 30, 250);
    kinds = run.kinds;
    for (const [kind, count] of Object.entries(run.changed))
      changed[kind] = (changed[kind] ?? 0) + count;
  }
  // Every kind of edit moved a matrix develop draws: one the pass missed would fail above.
  for (const kind of kinds) assert.ok(changed[kind] > 0, `${kind} changed none`);
});

test('an empty graph walks its root, a maximal one keeps develop world matrices', () => {
  const empty = createChangedSubtrees(new Scene());
  assert.equal(empty.run(), 1);
  assert.equal(empty.run(), 0);
  replay(3, 4096, 10);
});

test('an image walks only the subtrees that changed, never the whole graph', () => {
  const { scene, nodes } = graph(11, 2000);
  const pass = createChangedSubtrees(scene);
  scene.traverse(
    (node) => (node._link = { pose: pass.heard, posed() {}, structure: pass.heard, content() {} }),
  );
  assert.equal(pass.run(), 2001);
  assert.equal(pass.run(), 0, 'nothing moved: nothing walked');
  const leaf = nodes.find((node) => !node.children.length)!;
  leaf.position.x = 1.5;
  assert.equal(pass.run(), 1, 'a moved leaf walks itself');
  const holder = nodes.find((node) => node.children.length)!;
  let size = 0;
  holder.traverse(() => size++);
  holder.position.y = -2;
  leaf.position.z = 3;
  assert.equal(
    pass.run(),
    size + (within(leaf, holder) ? 0 : 1),
    'a moved group walks its subtree',
  );
});
