// A move reads its node from the name index, visits only the roots under it and refreshes only its
// subtree (#915). Two twin worlds of a few thousand nodes take the same random program — moves by
// name, host pose writes, renames, additions, removals, reparentings, images — one as it stands,
// the other with every move walking the whole index (`refresh`), as before. After every step the
// rows, dirty marks, world boxes, shadow-mobility calls and motion boxes are the same bits, the
// named node is the walk's, the moved roots are the climb's; after every image, every root's world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as G from '../../../host/graph/graph.fixture.ts';
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import { setWebgpuTransform } from './transform.ts';
import { findNode, rootsUnder } from './movedNode.ts';
import { racine, runtime } from '../../core/transformShear.fixture.ts';
import { hostWorldPlacements } from '../../../host/world/placements.ts';
import {
  climbUnder,
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
function worldPose(draw: Draw) {
  const turn = new G.Quaternion(draw() - 0.5, draw() - 0.5, draw() - 0.5, draw() + 0.1).normalize();
  const at = new G.Vector3(draw() * 20 - 10, draw() * 20 - 10, -0),
    scale = new G.Vector3(0.5 + draw(), 0.5 + draw(), 0.5 + draw());
  return new Float32Array(new G.Matrix4().compose(at, turn, scale).elements);
}

/** One world of 3000 nodes, two to a name, a root per mesh, a row per root, and a log of what moves declared.
 *  `whole`: every move walks the whole index, as before #915. */
async function world(seed: number, lot: boolean, whole: boolean) {
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
  mobility.move = (rank, pose, forced) => (log.push([rank, ...pose]), move(rank, pose, forced));
  const image = () => {
    run.gate.readScene(source, () => roots.map((root) => root.pages[0]));
    run.gate.updateWorlds(worlds);
  };
  image();
  return { rt, source, nodes, roots, rows, log, image };
}
type World = Awaited<ReturnType<typeof world>>;

/** True when `node` is `of` or one of its ancestors. */
function isAncestor(node: Object3D, of: Object3D) {
  for (let walk: Object3D | null = of; walk; walk = walk.parent) if (walk === node) return true;
  return false;
}

/** The same drawn edit on both twins: a pose, a rename, an addition, a removal, a reparenting or
 *  an image. Returns the rank edited. */
function edit(draw: Draw, kind: number, [a, b]: World[]) {
  // Early ranks carry the deep subtrees: they are edited more often.
  const at = Math.floor(draw() ** 3 * a.nodes.length),
    to = Math.floor(draw() * a.nodes.length),
    seed = Math.floor(draw() * 1e9),
    name = draw() < 0.5 ? pick(draw, a.nodes).name : `fresh${seed}`;
  for (const { nodes, image } of [a, b]) {
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

/** Runs a move; the engine code it was refused with, if any — anything else fails the test. */
function moveBy(x: World, name: string, pose: Float32Array) {
  try {
    setWebgpuTransform(x.rt, name, pose);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!code) throw error;
    return code;
  }
}

/** Bit-identical typed arrays; the slow per-component message only once they differ. */
function sameBits(a: Float32Array | Float64Array | Uint8Array, b: typeof a, label: string) {
  const bytes = (x: typeof a) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (!bytes(a).equals(bytes(b))) assertBits(a, b, label);
}

function assertSame(a: World, b: World, label: string, worlds: boolean) {
  sameBits(a.rows.pageTableFloats, b.rows.pageTableFloats, `${label} rows`);
  sameBits(a.rows.dirty, b.rows.dirty, `${label} dirty`);
  a.roots.forEach((root, i) => sameBits(root.worldBox!, b.roots[i].worldBox!, `${label} box`));
  assert.deepEqual(a.log, b.log, `${label} motion and mobility`);
  a.log.length = b.log.length = 0;
  if (worlds)
    a.roots.forEach((root, i) =>
      sameBits(root.world.elements, b.roots[i].world.elements, `${label} world`),
    );
}

for (const lot of [false, true])
  test(`move by index and subtree: the bits of the whole walk — ${lot ? 'box lot' : 'box by box'}`, async () => {
    for (let seed = 1; seed <= 3; seed++) {
      const twins = [await world(seed, lot, false), await world(seed, lot, true)];
      const [a, b] = twins,
        draw = seeded(seed * 7907 + (lot ? 1 : 0)),
        out: number[] = [];
      let edited = 0;
      for (let step = 0; step < 300; step++) {
        const label = `seed ${seed} step ${step}`;
        // Poses and renames come twice as often as the other edits.
        if (draw() < 0.4) edited = edit(draw, Math.floor(draw() * 8) % 6, twins);
        // Half the moves fall below the node last edited: a pose the host set above them.
        const below: Object3D[] = [];
        a.nodes[edited].traverse((node) => void below.push(node));
        const name = pick(draw, draw() < 0.5 && below.length > 1 ? below.slice(1) : a.nodes).name,
          pose = worldPose(draw);
        const node = G.byName(a.source, name);
        // Identity alone: a failing message would print the whole graph.
        assert.ok(findNode(a.source, name) === node, `${label}: ${name} is not the walk's`);
        if (node) assert.deepEqual(rootsUnder(a.roots, node, out), climbUnder(a.roots, node), label);
        assert.equal(moveBy(a, name, pose), moveBy(b, name, pose), label);
        assertSame(a, b, label, false);
        if (draw() < 0.2) {
          a.image();
          b.image();
          assertSame(a, b, `${label} image`, true);
        }
      }
    }
  });
