// POC: a parent whose seated children a session composes on the GPU sends its world alone when it
// turns: no row is written, no range is sent, whatever the number of children.
import test from 'node:test';
import assert from 'node:assert/strict';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { createPlacementRows } from '../../placement/rows.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { createWorldPoses, type PoseComposer } from './worldPoses.ts';
import type { Seat } from './worldBatches.ts';

const N = 12000;

function galaxy(count = N) {
  const scene = object.group(),
    parent = object.group(),
    shape = geometry.box(1, 1, 1),
    rows = createPlacementRows(count),
    batch = { rows },
    seats = new Map<Mesh, Seat>();
  scene.add(parent);
  for (let i = 0; i < count; i++) {
    const mesh = object.mesh(shape);
    mesh.position.set(i % 100, 0, Math.floor(i / 100));
    mesh.rotation.set(i * 0.01, 0, 0);
    parent.add(mesh);
    seats.set(mesh, { batch, row: i } as unknown as Seat);
  }
  return { scene, parent, rows, seats };
}

test('turning a parent of 12 000 composed rows sends one matrix and writes no row', () => {
  const { scene, parent, rows, seats } = galaxy();
  const poses = createWorldPoses(),
    sent: number[][] = [],
    linked: { links: number; world: number[] }[] = [];
  const composer: PoseComposer = {
    key: scene,
    epoch: 0,
    link: (_, world, links) => (
      linked.push({ links: links.length, world: Array.from(world) }),
      true
    ),
  };
  const send = (_: unknown, from: number, to: number) => void sent.push([from, to]);
  poses.moved(parent);
  poses.apply(scene, seats, new Map(), send, composer);
  assert.deepEqual(sent, [[0, N - 1]], 'the first write is whole');
  assert.equal(linked.at(-1)!.links, N, 'and links every child');
  const before = rows.matrices.slice();
  parent.rotation.y = 0.7;
  poses.moved(parent);
  poses.apply(scene, seats, new Map(), send, composer);
  assert.equal(sent.length, 1, 'no range is sent');
  assert.deepEqual(rows.matrices, before, 'no row is written');
  assert.deepEqual(linked.at(-1), { links: 0, world: [...parent.matrixWorld.elements] });
});

test('without a composer, turning the parent writes every row', () => {
  const { scene, parent, rows, seats } = galaxy();
  const poses = createWorldPoses(),
    sent: number[][] = [];
  const send = (_: unknown, from: number, to: number) => void sent.push([from, to]);
  poses.moved(parent);
  poses.apply(scene, seats, new Map(), send);
  parent.rotation.y = 0.7;
  poses.moved(parent);
  poses.apply(scene, seats, new Map(), send);
  assert.deepEqual(sent, [
    [0, N - 1],
    [0, N - 1],
  ]);
  const last = [...parent.children.at(-1)!.matrixWorld.elements];
  assert.deepEqual([...rows.matrices.subarray((N - 1) * 16, N * 16)], last);
});

test('a composed parent destroyed is unlinked once its seats move on, its world never read', () => {
  const { scene, parent, seats } = galaxy(4);
  const poses = createWorldPoses(),
    unlinked: object[] = [];
  const composer: PoseComposer = {
    key: scene,
    epoch: 0,
    link: (node, _, links, whole) => (whole && !links.length && unlinked.push(node), true),
  };
  const apply = () => poses.apply(scene, seats, new Map(), () => {}, composer);
  poses.moved(parent);
  apply();
  parent.destroy();
  seats.clear();
  composer.epoch++;
  apply();
  assert.deepEqual(unlinked, [parent], 'unlinked, the session holds none of its rows');
  apply();
  assert.equal(unlinked.length, 1, 'and forgotten');
});
