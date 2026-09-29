// #972: the move index follows a host reparent. The engine's tree kept the parent links it was
// built on, so a node the host moved under another parent still moved with its old one through
// `setTransform`. Now a reparent, a removal, a swap of parent and child or a subtree carried out
// of the source relinks the tree: each world is the host chain's, bit for bit, on both passes.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as G from '../graph/graph.fixture.ts';
import { prepareSdkWasm } from '../../page/decode/geometryPageWasm.ts';
import { prepareMathBatch } from '../../math/batchState.ts';
import { hostWorldLot, hostWorldTree } from './tree.ts';
import { hostWorldChainInto } from './chain.ts';
import { setWebgpuTransform } from '../../webgpu/pages/render/transform.ts';
import { selectionRoot, runtime } from '../../webgpu/core/transformShear.fixture.ts';
import { hostWorldPlacements } from './placements.ts';
import { assertBits } from '../../../../../tests/kit/assert/bits.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

await prepareSdkWasm(readFileSync(join(import.meta.dirname, '../../page/decode/pageCodec.wasm')));

/** source > a > b, source > c > d, every node posed apart. */
function scene() {
  const source = new G.Group(),
    [a, b, c, d] = ['a', 'b', 'c', 'd'].map((name) => Object.assign(new G.Group(), { name }));
  source.add(a, c);
  a.add(b);
  c.add(d);
  a.position.set(5, 0, 0);
  b.position.set(0, 1, 0);
  c.position.set(0, 0, -3);
  c.scale.set(2, -1, 0.5);
  d.position.set(-0, 2, 7);
  return { source, a, b, c, d };
}

const chain = (node: Object3D) => hostWorldChainInto(new Float64Array(16), node);

for (const batched of [false, true])
  test(`reparent, removal and swap: each world is the host chain's — ${batched ? 'lot' : 'tree'}`, async () => {
    if (batched) await prepareMathBatch('wasm');
    const { source, a, b, c, d } = scene();
    const index = hostWorldTree(source, batched ? await hostWorldLot(source) : null);
    const check = (label: string) => {
      for (const node of [a, b, c, d])
        if (node.parent) assertBits(index.world(node), chain(node), `${label} ${node.name}`);
    };
    c.add(b); // b leaves a for c
    index.refreshFrom(a);
    check('reparented');
    a.position.x = 9; // a moves: b no longer follows it
    index.refreshFrom(a);
    check('old parent moved');
    c.remove(d);
    source.add(d);
    index.refresh();
    check('carried up');
    c.remove(b);
    b.add(c); // c, parent of b a moment ago, now its child: no cycle on the way
    source.add(b);
    index.refresh();
    check('swapped');
    b.remove(c);
    index.refresh(); // c is out of the source: nothing throws, the others stand
    check('removed');
  });

test('a node reparented by the host moves with its new parent through setTransform', () => {
  const { source, b, c } = scene();
  const mesh = G.mesh();
  b.add(mesh);
  const worlds = hostWorldPlacements(source);
  const root = selectionRoot(mesh, [-1, -1, -1, 1, 1, 1], worlds);
  const { rt } = runtime(source, [root], worlds);
  c.add(b);
  const moved = new Float32Array(new G.Matrix4().makeTranslation(40, 0, 0).elements);
  setWebgpuTransform(rt, 'a', moved); // b's old parent: b stays where c holds it
  assertBits(root.world.elements as Float64Array, chain(mesh), 'the mesh under b, under c');
  setWebgpuTransform(rt, 'c', moved); // its new parent carries it
  assertBits(root.world.elements as Float64Array, chain(mesh), 'the mesh follows c');
});
