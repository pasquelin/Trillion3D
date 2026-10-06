import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createPartitionCells } from '../../partition/cells.ts';
import { placedMesh } from '../../partition/rows.ts';
import { decodeHere, io, opened, settled } from '../../partition/cells.fixture.ts';
import { paged } from '../../partition/paged.fixture.ts';
import { createArrivalQueue, type ArrivalTarget } from './arrivalQueue.ts';
import { createFrameBudget } from './frameBudget.ts';
import { referenceArrivalQueue } from '../../../../../bench/oracles/browser/arrival-admission.ts';

function target() {
  const accepted: string[] = [];
  let syncs = 0;
  return {
    accepted,
    get syncs() {
      return syncs;
    },
    acceptPage(url: string) {
      accepted.push(url);
    },
    syncResident() {
      syncs++;
    },
  };
}

test('a drain stops at the byte budget and the next one resumes where it left off', () => {
  const a = target();
  // Three 8-byte pages for a budget of 12: the second exceeds the budget and closes the drain.
  const queue = createArrivalQueue(12, 64, createFrameBudget(Infinity));
  for (const url of ['p0', 'p1', 'p2']) assert.equal(queue.queue(a, url, new Uint32Array(2)), true);
  assert.equal(queue.pending, 3);
  assert.equal(queue.drain(), 2, 'the byte budget stops the drain');
  assert.deepEqual(a.accepted, ['p0', 'p1'], 'arrival order preserved');
  assert.equal(a.syncs, 0, 'the next render synchronizes without an intermediate submit');
  assert.equal(queue.pending, 1);
  assert.equal(queue.drain(), 1);
  assert.deepEqual(a.accepted, ['p0', 'p1', 'p2']);
  assert.equal(a.syncs, 0);
  assert.equal(queue.drain(), 0, 'empty queue: nothing to deliver and no residency');
  assert.equal(a.syncs, 0);
});

test('a page already waiting for a target is queued once, and each target keeps its own residency', () => {
  const a = target(),
    b = target();
  const queue = createArrivalQueue(1 << 20, 2, createFrameBudget(Infinity));
  const page = new Uint32Array(1);
  assert.equal(queue.queue(a, 'p0', page), true);
  assert.equal(queue.queue(a, 'p0', page), false, 'already waiting for this target');
  assert.equal(queue.queue(b, 'p0', page), true, 'each target keeps its own residency');
  assert.equal(queue.queue(a, 'p1', page), true);
  assert.equal(
    queue.queue({} as ArrivalTarget, 'p0', page),
    false,
    'without acceptPage, nothing to deliver',
  );
  assert.equal(queue.drain(), 2, 'the page budget stops the drain');
  assert.deepEqual(a.accepted, ['p0']);
  assert.deepEqual(b.accepted, ['p0']);
  assert.equal(a.syncs, 0);
  assert.equal(b.syncs, 0);
  // The queue only keeps waiting pages: a page redelivered later is re-queued behind the rest.
  assert.equal(queue.queue(a, 'p0', page), true);
  assert.equal(queue.drain(), 2);
  assert.deepEqual(a.accepted, ['p0', 'p1', 'p0']);
  assert.equal(a.syncs, 0);
  assert.equal(b.syncs, 0);
});

// Delivery preserves exact pages and order despite removing implicit rendering.
test('many duplicate targets across a drain deliver exactly like the reference', () => {
  function arrivals(queue: Pick<ReturnType<typeof referenceArrivalQueue>, 'queue' | 'drain'>) {
    const delivered: string[] = [];
    const targets = Array.from({ length: 8 }, (_, c) => ({
      acceptPage: (url: string) => delivered.push(`${c}:${url}`),
    }));
    const bytes = new Uint32Array(4);
    // Round-robin over the eight targets so the touched list sees many repeats before a drain.
    for (let i = 0; i < 500; i++) queue.queue(targets[i % 8], `page-${i % 50}.bin`, bytes);
    let livrs = 0;
    for (let d = 0; d < 3; d++) livrs += queue.drain();
    return { delivered, livrs };
  }
  const optimisee = arrivals(createArrivalQueue(1 << 20, 4096, createFrameBudget(Infinity)));
  const reference = arrivals(referenceArrivalQueue(1 << 20, 4096));
  assert.deepEqual(optimisee, reference);
});

test('the frame budget yields at its boundary and resumes in arrival order', (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const accepted: string[] = [];
  const receiver = {
    acceptPage(url: string) {
      accepted.push(url);
      now += url === 'slow' ? 3 : 1;
    },
  };
  const budget = createFrameBudget(2);
  const queue = createArrivalQueue(1 << 20, 64, budget);
  for (const url of ['p0', 'p1', 'slow', 'p3']) queue.queue(receiver, url, new Uint32Array(1));
  const frame = () => (budget.open(), queue.drain());
  assert.equal(frame(), 2, 'two 1 ms deliveries reach the 2 ms ceiling');
  assert.deepEqual(accepted, ['p0', 'p1']);
  assert.equal(queue.pending, 2);
  assert.equal(frame(), 1, 'an over-budget first delivery still makes progress');
  assert.deepEqual(accepted, ['p0', 'p1', 'slow']);
  assert.equal(queue.pending, 1);
  assert.equal(frame(), 1);
  assert.deepEqual(accepted, ['p0', 'p1', 'slow', 'p3']);
  assert.equal(queue.pending, 0);
  assert.equal(frame(), 0);
});

test('a drain spends what its frame left of the budget, and never opens it again', (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const budget = createFrameBudget(2);
  const queue = createArrivalQueue(1 << 20, 64, budget);
  queue.queue({ acceptPage() {} }, 'p0', new Uint32Array(1));
  budget.open();
  budget.spend();
  now = 3; // the frame's cells spent it
  assert.equal(queue.drain(), 0, 'the page waits for the next frame');
  budget.open();
  assert.equal(queue.drain(), 1);
});

test('the cells a frame places and the pages it drains spend one budget, on one clock', async (t) => {
  // Placing a decoded cell costs 1.5 ms and a page 1 ms, against the 2 ms ceiling.
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const node = { parent: null, mesh: 0, matrix: null, rotation: null, scale: null };
  const body = (x: number) =>
    JSON.stringify({ version: 2, nodes: [{ ...node, translation: [x, 0, 0] }] });
  const records = [0, 1, 2].map((x) => ({
    url: `${x}.json`,
    sha256: '',
    bytes: 1,
    parents: [[null, [x, 0, 0, x + 1, 1, 1]] as const],
    meshes: [[0, 1] as const],
    meshPages: [],
  }));
  const { partition, files } = paged(records, 3);
  const cells = createPartitionCells({
    partition,
    base: 'https://cache.test/key/',
    root: new Group(),
    parents: [],
    meshes: new Map([[0, placedMesh([{ meshes: 0 }])]]),
  });
  const bytes = (url: string) => {
    const name = url.split('/').at(-1)!;
    return files.get(name) ?? new TextEncoder().encode(body(Number(name.split('.')[0])));
  };
  const { port, held } = io(bytes);
  await opened(cells, bytes, 100, false, [1e9, 0, 0]); // rows for every node, nothing read
  port.decode = async (bytes: Uint8Array) => {
    const rows = await decodeHere(bytes);
    return {
      ...rows,
      get nodes() {
        now += 1.5;
        return rows.nodes;
      },
    };
  };
  // The page of the index is opened, then every cell handed to the decode, none placed.
  const free = { admits: () => true, spend() {} };
  await settled(cells, [0, 0.5, 0.5], 100, port, free);
  records.forEach(({ url }) => held.add(`https://cache.test/key/${url}`));
  cells.frame([0, 0.5, 0.5], 100, port, free);
  await Promise.all(cells.decodes());
  const accepted: string[] = [];
  const receiver = { acceptPage: (url: string) => void (accepted.push(url), (now += 1)) };
  const budget = createFrameBudget(2);
  const queue = createArrivalQueue(1 << 20, 64, budget);
  for (const url of ['p0', 'p1']) queue.queue(receiver, url, new Uint32Array(1));
  const frame = () => {
    budget.open();
    cells.frame([0, 0.5, 0.5], 100, port, budget);
    queue.drain();
    return [cells.stats().held, accepted.length];
  };
  // A piece is admitted while the clock is under the ceiling: the second cell still is.
  assert.deepEqual(frame(), [2, 0], 'two cells spend the frame: no page after them');
  assert.deepEqual(frame(), [3, 1], 'the last cell leaves room for one page');
  assert.deepEqual(frame(), [3, 2]);
});
