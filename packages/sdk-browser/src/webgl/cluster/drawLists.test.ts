// #984 (audit CPU-22): the draw lists kept between images are the ones develop's full walk finds,
// in the same order once sorted, on random graphs and random edit sequences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawLists } from './drawLists.ts';
import { createDrawOrder, type OrderedNode } from './drawOrder.ts';
import { Scene } from '../../world/core/scene.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { Group, type Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { GraphSurface } from '../../host/graph/surface.ts';
import { isDrawnNode } from '../../host/graph/kinds.ts';
import type { HostMesh } from '../../host/resources.ts';
import { firstMaterial } from '../../scene/materialSide.ts';
import { pick as pickOf, seeded } from '../../host/world/randomTree.fixture.ts';
import { HOSTILE_FLOATS } from '../../../../../tests/kit/assert/hostile.ts';

const EDGES = [...HOSTILE_FLOATS, 1e308, -1e308, 1, -2.5];
/** A perspective-like screen: depths read clip z over clip w. */
const SCREEN = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.2, -1, 0, 0, -0.2, 0];

/** Develop's walk, frozen: every visible mesh under the children, a copy or a see-through
 *  surface to the see-through list. */
function developLists(scene: Scene, copies: readonly object[]) {
  const copied = new Set(copies);
  const opaque: HostMesh[] = [],
    seeThrough: HostMesh[] = [];
  for (const child of scene.children)
    child.traverseVisible((node) => {
      if (!isDrawnNode(node)) return;
      if (copied.has(node) || firstMaterial(node.material)?.transparent) seeThrough.push(node);
      else opaque.push(node);
    });
  return { opaque, seeThrough };
}

type Graph = ReturnType<typeof graph>;

/** A random graph of groups and meshes over a few shared surfaces and shapes. */
function graph(seed: number, size: number) {
  const rnd = seeded(seed);
  const pick = <T>(list: readonly T[]) => pickOf(rnd, list);
  const surfaces = Array.from(
    { length: 4 },
    (_, i) => new GraphSurface('standard', { transparent: i % 2 === 1 }),
  );
  const shapes = Array.from({ length: 3 }, () =>
    new Geometry().setAttribute(
      'position',
      new BufferAttribute(
        Float32Array.from({ length: 9 }, () => rnd() * 4 - 2),
        3,
      ),
    ),
  );
  const scene = new Scene(),
    nodes: Object3D[] = [scene],
    copies: object[] = [];
  const make = () => {
    const node = rnd() < 0.3 ? new Group() : new Mesh(pick(shapes), pick(surfaces));
    node.renderOrder = rnd() < 0.2 ? pick(EDGES) : 0;
    node.position.set(rnd() * 8 - 4, rnd() * 8 - 4, -rnd() * 8);
    nodes.push(node);
    return node;
  };
  const within = (node: Object3D, top: Object3D) => {
    for (let at: Object3D | null = node; at; at = at.parent) if (at === top) return true;
    return false;
  };
  const placed = () => nodes.filter((node) => within(node, scene));
  const holders: Object3D[] = [scene];
  for (let i = 0; i < size; i++) {
    const node = make();
    pick(holders).add(node);
    if (!isDrawnNode(node)) holders.push(node);
  }
  const members = () => placed().filter((n) => n !== scene);
  const meshes = () => nodes.filter(isDrawnNode);
  /** Each edit a page makes to a graph, on a node it picks. */
  const edits: Record<string, () => void> = {
    add: () => pick(placed()).add(make()),
    remove: () => pick(members())?.removeFromParent(),
    reparent: () => {
      const node = pick(members());
      if (node) pick(placed().filter((n) => !within(n, node))).add(node);
    },
    hide: () => {
      const node = pick(members());
      if (node) node.visible = !node.visible;
    },
    move: () => pick(nodes).position.set(pick(EDGES), pick(EDGES), pick(EDGES)),
    order: () => void (pick(nodes).renderOrder = pick(EDGES)),
    swap: () => {
      const mesh = pick(meshes());
      mesh.material = rnd() < 0.5 ? pick(surfaces) : [pick(surfaces), pick(surfaces)];
    },
    flip: () => {
      const surface = pick(surfaces);
      surface.transparent = !surface.transparent;
      surface.needsUpdate = true;
    },
    copy: () => copies.push(pick(meshes())),
  };
  return { scene, copies, edits, kinds: Object.keys(edits), pick };
}

/** The lists and their sorted order, kept and developed side by side over `steps` random edits;
 *  how many edits of each kind changed what develop draws. */
function replay({ scene, copies, edits, kinds, pick }: Graph, steps: number) {
  const lists = createDrawLists(scene, copies);
  const kept = createDrawOrder(),
    developed = createDrawOrder();
  const changed = Object.fromEntries(kinds.map((kind) => [kind, 0]));
  let before = '';
  // Compared by creation rank: a failure prints two short lists, never two graphs.
  const ids = new Map<object, number>();
  const id = (node: object) => ids.get(node) ?? (ids.set(node, ids.size), ids.size - 1);
  const named = (...lists: readonly object[][]) => lists.map((list) => list.map(id));
  for (let step = 0; step <= steps; step++) {
    const kind = step ? pick(kinds) : '';
    if (kind) edits[kind]();
    scene.updateMatrixWorld();
    lists.refresh();
    const want = developLists(scene, copies);
    const [opaque, seeThrough] = [[...lists.opaque], [...lists.seeThrough]];
    const listed = named(want.opaque, want.seeThrough);
    assert.deepEqual(named(opaque, seeThrough), listed, `lists after ${kind} (step ${step})`);
    kept(opaque as OrderedNode[], seeThrough as OrderedNode[], SCREEN);
    developed(want.opaque as OrderedNode[], want.seeThrough as OrderedNode[], SCREEN);
    const sorted = named(want.opaque, want.seeThrough);
    assert.deepEqual(named(opaque, seeThrough), sorted, `order after ${kind} (step ${step})`);
    const drawn = JSON.stringify(sorted);
    if (kind && drawn !== before) changed[kind]++;
    before = drawn;
  }
  lists.dispose();
  return changed;
}

test('random graphs and 10 000 random edits keep develop lists and order', () => {
  const changed: Record<string, number> = {};
  for (let seed = 1; seed <= 40; seed++)
    for (const [kind, count] of Object.entries(replay(graph(seed, 30), 250)))
      changed[kind] = (changed[kind] ?? 0) + count;
  // Every kind of edit changed what develop draws: one the lists missed would fail above.
  for (const [kind, count] of Object.entries(changed)) assert.ok(count > 0, `${kind} changed none`);
});

test('an empty graph draws nothing, a maximal one keeps develop lists', () => {
  const empty = graph(7, 0);
  const lists = createDrawLists(empty.scene, empty.copies);
  lists.refresh();
  assert.deepEqual([lists.opaque, lists.seeThrough], [[], []]);
  replay(graph(3, 4096), 10);
});

test('a link the graph had keeps hearing, and gets the graph back', () => {
  const heard: string[] = [];
  const scene = new Scene(),
    before = new Mesh();
  scene.add(before);
  const had = {
    pose: () => heard.push('pose'),
    posed: () => heard.push('posed'),
    structure: () => heard.push('structure'),
    content: () => heard.push('content'),
    seatEpoch: () => 7,
  };
  scene._link = before._link = had;
  const lists = createDrawLists(scene, []);
  const added: HostMesh = new Mesh(undefined, new GraphSurface('basic'));
  scene.add(added);
  added.visible = false;
  added.material = new GraphSurface('standard');
  added._link!.posed([added]);
  assert.deepEqual(heard, ['structure', 'pose', 'content', 'posed']);
  assert.equal(added._link!.seatEpoch!(), 7);
  lists.dispose();
  for (const node of [scene, before, added]) assert.equal(node._link, had);
});
