// Twin worlds for the equivalence tests of a move (#915, #971): a random host tree of 3000 nodes,
// a root per mesh, a row per root, a log of what moves declared, the same edits drawn on each twin.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as G from '../../../host/graph/graph.fixture.ts';
import { BOX_VALUES, boxTransform } from '../../../../../sdk-core/src/index.ts';
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import { racine, runtime } from '../../core/transformShear.fixture.ts';
import { hostWorldPlacements } from '../../../host/world/placements.ts';
import {
  drawPose,
  pick,
  randomTree,
  seeded,
  type Draw,
} from '../../../host/world/randomTree.fixture.ts';
import { prepareSdkWasm } from '../../../page/decode/geometryPageWasm.ts';
import { reserveRootBoxes } from '../../../math/batchBoxes.ts';
import { assertBits } from '../../../../../../tests/kit/assert/bits.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

await prepareSdkWasm(
  readFileSync(join(import.meta.dirname, '../../../page/decode/pageCodec.wasm')),
);

const ROW_WORDS = PAGE_INFO_STRIDE / 4;

/** A world pose drawn at random: translation, a turn, a positive scale. */
export function worldPose(draw: Draw) {
  const turn = new G.Quaternion(draw() - 0.5, draw() - 0.5, draw() - 0.5, draw() + 0.1).normalize();
  const at = new G.Vector3(draw() * 20 - 10, draw() * 20 - 10, -0),
    scale = new G.Vector3(0.5 + draw(), 0.5 + draw(), 0.5 + draw());
  return new Float32Array(new G.Matrix4().compose(at, turn, scale).elements);
}

/** One world of 3000 nodes, two to a name, a root per mesh, a row per root, and a log of what moves declared.
 *  `whole`: every move walks the whole index, as before #915. */
export async function world(seed: number, lot: boolean, whole: boolean) {
  const draw = seeded(seed);
  const { source, nodes } = randomTree(draw, 3000, 1500);
  const worlds = hostWorldPlacements(source);
  if (whole) Object.assign(worlds, { refreshFrom: () => worlds.refresh() });
  const meshes = nodes.filter((node) => node instanceof G.Mesh);
  const roots = meshes.map((mesh, i) => {
    const low = [draw() - 1, draw() - 1, draw() - 1];
    const root = racine(mesh, [...low, low[0] + 2 * draw(), low[1] + draw(), low[2] + 3], worlds);
    // The page carries its root's world, as a collected page does: its row is that matrix.
    Object.assign(root.pages[0], { packedIndex: i, matrix: root.world });
    return root;
  });
  const { rt, layout, run, mouvements } = runtime(source, roots, worlds);
  const log: unknown[] = mouvements,
    n = roots.length,
    ranks = Int32Array.from(roots, (_, i) => i),
    dirty = new Uint8Array(n);
  const rows = {
    pageTableFloats: new Float32Array(n * ROW_WORDS),
    packedCount: n,
    rowOfPage: ranks,
    packedPageIndex: ranks,
    blendRowOf: new Int32Array(n).fill(-1),
    dirty,
    markRowDirty: (row: number) => void (dirty[row] = 1),
  };
  Object.assign(layout, { rows, rootBoxes: lot ? await reserveRootBoxes(roots) : null });
  const mobility = rt.lights.mobility;
  mobility.ensure(n, n, (rank) => roots[rank].world.elements);
  const move = mobility.move.bind(mobility);
  mobility.move = (rank, pose, forced) => (
    log.push([rank, ...Array.from(pose)]),
    move(rank, pose, forced)
  );
  const image = () => {
    run.gate.readScene(source, () => roots.map((root) => root.pages[0]));
    run.gate.updateWorlds(worlds);
  };
  image();
  return { rt, source, nodes, roots, rows, log, image };
}
export type World = Awaited<ReturnType<typeof world>>;

/** True when `node` is `of` or one of its ancestors. */
export function isAncestor(node: Object3D, of: Object3D) {
  for (let walk: Object3D | null = of; walk; walk = walk.parent) if (walk === node) return true;
  return false;
}

/** The same drawn edit on every twin: a pose, a rename, an addition, a removal, a reparenting or
 *  an image. Returns the rank edited. */
export function edit(draw: Draw, kind: number, twins: World[]) {
  const [a] = twins;
  // Early ranks carry the deep subtrees: they are edited more often.
  const at = Math.floor(draw() ** 3 * a.nodes.length),
    to = Math.floor(draw() * a.nodes.length),
    seed = Math.floor(draw() * 1e9),
    name = draw() < 0.5 ? pick(draw, a.nodes).name : `fresh${seed}`;
  for (const { nodes, image } of twins) {
    const node = nodes[at],
      parent = nodes[to];
    if (kind === 0) drawPose(seeded(seed), node);
    else if (kind === 1) node.name = name;
    else if (kind === 2) {
      const added = new G.Group();
      added.name = name;
      parent.add(added);
      nodes.push(added);
    } else if (kind === 3 && node !== nodes[0]) node.removeFromParent();
    else if (kind === 4 && !isAncestor(node, parent)) parent.add(node);
    else if (kind === 5) image();
  }
  return at;
}

/** Bit-identical typed arrays; the slow per-component message only once they differ. */
export function sameBits(a: Float32Array | Float64Array | Uint8Array, b: typeof a, label: string) {
  const bytes = (x: typeof a) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (!bytes(a).equals(bytes(b))) assertBits(a, b, label);
}

export function assertSame(a: World, b: World, label: string, worlds: boolean) {
  sameBits(a.rows.pageTableFloats, b.rows.pageTableFloats, `${label} rows`);
  sameBits(a.rows.dirty, b.rows.dirty, `${label} dirty`);
  a.roots.forEach((root, i) => sameBits(root.worldBox!, b.roots[i].worldBox!, `${label} box`));
  assert.deepEqual(a.log, b.log, `${label} motion and mobility`);
  a.log.length = b.log.length = 0;
  if (worlds)
    a.roots.forEach((root, i) =>
      // The engine's poses are views on its world buffer (`placements.ts`).
      sameBits(
        root.world.elements as Float64Array,
        b.roots[i].world.elements as Float64Array,
        `${label} world`,
      ),
    );
}

/**
 * Roots whose row differs between the batch twin `a` and the one-by-one twin `b`, taken by `b` and
 * the `others`. The engine index keeps the structure it was built on (`tree.ts`): a node the host
 * reparented still moves with its old parent there. One by one, such a root keeps the row and box
 * of the call that listed it while a later call moves it through that old link; the batch writes
 * both at the pose the root ends at. Each such root is proved that case — `a` agrees with its
 * world, `b` does not — then its row and box are copied over. Returns their ranks.
 */
export function takeFinalRows(a: World, b: World, others: World[]) {
  const taken = new Set<number>(),
    box = new Float64Array(BOX_VALUES),
    bytes = (x: World) => Buffer.from(x.rows.pageTableFloats.buffer);
  if (bytes(a).equals(bytes(b))) return taken;
  a.roots.forEach((root, i) => {
    const row = (x: World) => x.rows.pageTableFloats.subarray(i * ROW_WORDS, i * ROW_WORDS + 16);
    const [p, q] = [row(a), row(b)];
    if (p.every((v, k) => Object.is(v, q[k]))) return;
    const world = (x: World) => Float32Array.from(x.roots[i].world.elements);
    sameBits(p, world(a), `root ${i}: the batch row is its final world`);
    assert.ok(
      !q.every((v, k) => Object.is(v, world(b)[k])),
      `root ${i}: one by one left no old row`,
    );
    if (root.localBox) boxTransform(box, 0, root.localBox, 0, root.world.elements);
    if (root.localBox) sameBits(root.worldBox!, box, `root ${i}: the batch box is its final one`);
    for (const x of [b, ...others]) {
      row(x).set(p);
      x.roots[i].worldBox?.set(root.worldBox!);
    }
    taken.add(i);
  });
  return taken;
}
