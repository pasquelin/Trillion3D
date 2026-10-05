// Every GPU adoption reads the ranks its readback claims in the list held, whatever landed since
// the readback the host holds: one overwritten before it was adopted, one a moved residency voided,
// one cut past its list that grew it, a command buffer dropped, the bootstrap's list the GPU never
// held. The lists, records, order and bytes are the hashed difference's (`readbackChain.fixture.ts`);
// the catalogue is asked only for the pages no rank named, where the hashed difference asks it for
// every page of both lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { RigCut } from '../../gpu/dag/differenceRig.fixture.ts';
import { mountReadbackChain, range, settle } from './readbackChain.fixture.ts';

/** A cut whose two lists are `pages`. */
const both = (pages: number[]): RigCut => ({ asked: pages, drawn: pages });
/** Twenty pages held, then a cut that drops two of them and enters two: two lookups a list. */
const held = range(0, 20);
const moved = [...held.filter((page) => page !== 3 && page !== 5), 41, 42];

/** A cut on a list of `cap` ranks that adopted `held` first. */
async function holding(cap: number) {
  const m = await mountReadbackChain(cap, 200);
  m.send(both(held));
  await settle();
  m.adopt();
  return m;
}

test('a readback overwritten before it was adopted: the next names its pages by the held ranks', async () => {
  const m = await holding(64);
  m.send(both([...held.filter((page) => page !== 5), 40]));
  await settle();
  m.send(both(moved));
  await settle();
  assert.equal(m.adopt(), 4, 'two entries a list, no held page looked up');
});

test('a readback a moved residency voided is followed, never adopted', async () => {
  const m = await holding(64);
  m.send(both([...held, 40]));
  m.rig.selection.markWorld(0, 1);
  await settle();
  assert.equal(m.rig.selection.peek(), null, 'voided');
  m.send(both(moved));
  await settle();
  assert.equal(m.adopt(), 4);
});

test('a readback cut past its list grows it, and the kept snapshot moves with it', async () => {
  const m = await holding(32);
  // The held pages first: the truncated kept lists hold them all.
  m.send(both([...held, ...range(60, 80)]));
  await settle();
  m.send(both(moved));
  await settle();
  assert.equal(m.rig.resources.listCap, 80, 'grown, and that frame cut nothing');
  m.send(both(moved));
  await settle();
  assert.equal(m.adopt(), 4);
});

test('a command buffer dropped copies nothing, and the chain does not miss it', async () => {
  const m = await holding(64);
  const encoder = m.rig.resources.device.createCommandEncoder();
  m.send(both(range(100, 120)), encoder)?.(false);
  m.send(both(moved));
  await settle();
  assert.equal(m.adopt(), 4);
});

test("the bootstrap's list is found by its marks, then the readbacks by their ranks", async () => {
  const m = await mountReadbackChain(64, 200);
  m.hold([2, 3, 90, 91]);
  m.send(both(held));
  await settle();
  assert.equal(m.adopt(), 40, 'no rank names a list the GPU never held');
  m.send(both(moved));
  await settle();
  assert.equal(m.adopt(), 4);
});

test('a repeated page and one without a record are read as the hashed difference reads them', async () => {
  const m = await holding(64);
  m.send({ asked: [...moved, 7, 250, 41], drawn: [...moved, 250] });
  await settle();
  m.adopt();
  m.send({ asked: [7, ...moved, 250], drawn: moved });
  await settle();
  m.adopt();
});
