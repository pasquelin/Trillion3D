// movedNode.ts: the name index and the roots under a node answer what the walks they replace
// answered (#915) — the first node of that name in prefix order, and the roots whose mesh climbs
// to the node — on random trees with repeated names, then after renames, removals, additions,
// reparenting and freed nodes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { findNode, rootsUnder } from './movedNode.ts';
import {
  climbUnder,
  pick,
  randomTree,
  seeded,
  type Draw,
} from '../../../host/world/randomTree.fixture.ts';
import type { ClusterRoot } from '../../../page/selection/types.ts';
import type { PageRec } from '../../../page/selection/selection.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

/** The reference: a full walk, first hit in prefix order. */
function walkFor(source: Object3D, name: string) {
  let found: Object3D | undefined;
  source.traverse((node) => {
    if (!found && node.name === name) found = node;
  });
  return found;
}

let fresh = 0;
/** One edit the index is not told about: a rename, a removal, an addition, a reparenting, a
 *  freed node — a name taken from another node half the time, so an edited node may come ahead
 *  of the one the index held for that name. `kinds` 4 frees nothing. */
function edit(draw: Draw, source: Object3D, nodes: Object3D[], kinds = 5) {
  const node = pick(draw, nodes.slice(1)),
    kind = Math.floor(draw() * kinds);
  if (!node) return;
  const name = draw() < 0.5 ? pick(draw, nodes).name : `fresh${fresh++}`;
  if (kind === 0) node.name = name;
  else if (kind === 1) node.removeFromParent();
  else if (kind === 2) {
    const added = new G.Group();
    added.name = name;
    pick(draw, nodes).add(added);
    nodes.push(added);
  } else if (kind === 3) {
    const parent = pick(draw, [source, ...nodes]);
    if (!isAncestor(node, parent)) parent.add(node);
  } else {
    node.traverse((below) => nodes.splice(nodes.indexOf(below), 1));
    node.destroy();
  }
}

/** True when `node` is `of` or one of its ancestors. */
function isAncestor(node: Object3D, of: Object3D) {
  for (let walk: Object3D | null = of; walk; walk = walk.parent) if (walk === node) return true;
  return false;
}

test('findNode: the first node of that name in walk order, through every kind of edit', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const draw = seeded(seed);
    const { source, nodes } = randomTree(draw, 10 + Math.floor(draw() * 80), 12);
    const names = ['source', 'absent', '', ...Array.from({ length: 12 }, (_, i) => `n${i}`)];
    for (let round = 0; round < 10; round++) {
      for (const name of [...names, ...nodes.map((node) => node.name)])
        assert.equal(findNode(source, name), walkFor(source, name), `seed ${seed} ${name}`);
      edit(draw, source, nodes);
    }
  }
});

test('findNode: a node removed from the source is no longer found by its name', () => {
  const source = new G.Group(),
    crate = new G.Group();
  crate.name = 'Crate';
  source.add(crate);
  assert.equal(findNode(source, 'Crate'), crate);
  source.remove(crate);
  assert.equal(findNode(source, 'Crate'), undefined);
  const again = new G.Group();
  again.name = 'Crate';
  source.add(again);
  assert.equal(findNode(source, 'Crate'), again);
});

/** A root per drawn mesh of `nodes`, some meshes carrying two, one root carrying no page. */
function rootsOf(draw: Draw, nodes: Object3D[]) {
  const roots: ClusterRoot<PageRec>[] = [];
  for (const node of nodes) {
    if (draw() < 0.3) continue;
    const copies = draw() < 0.2 ? 2 : 1;
    for (let k = 0; k < copies; k++)
      roots.push({ pages: [{ sourceMesh: node } as unknown as PageRec] } as ClusterRoot<PageRec>);
  }
  roots.push({ pages: [] as PageRec[] } as ClusterRoot<PageRec>);
  // A mesh outside the source: under no node of it.
  roots.push({ pages: [{ sourceMesh: G.mesh() } as unknown as PageRec] } as ClusterRoot<PageRec>);
  return roots;
}

test('rootsUnder: the roots whose mesh climbs to the node, in rank order, through reparenting', () => {
  const out: number[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    const draw = seeded(seed * 31);
    const { source, nodes } = randomTree(draw, 10 + Math.floor(draw() * 80));
    const roots = rootsOf(draw, nodes);
    for (let round = 0; round < 10; round++) {
      for (const node of nodes)
        assert.deepEqual(rootsUnder(roots, node, out), climbUnder(roots, node), `seed ${seed}`);
      edit(draw, source, nodes, 4);
    }
  }
});
