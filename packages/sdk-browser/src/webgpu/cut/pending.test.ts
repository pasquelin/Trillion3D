// The pending set follows the cut, never the catalogue (#486): it names only the closures of cut
// records, rereads only the cut's dependents when one leaves, and rebuilds the awaited list only
// when the cut, an arrival or the pool's acceptance moved — a still frame over budget costs
// nothing to read.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import { createCutDelta } from './delta.ts';
import { createCutPending } from './pending.ts';

/** Eight records: record `2k + 1` is installed after record `2k`, its bundle. */
function world() {
  const packed = Array.from({ length: 8 }, (_, id) => ({ url: `p${id}`, packedIndex: id }));
  for (let id = 1; id < 8; id += 2)
    (packed[id] as { dependencies?: unknown[] }).dependencies = [packed[id - 1]];
  return packed as unknown as PageRec[];
}

test('the awaited list is rebuilt only when something it reads moved', () => {
  const packed = world(),
    delta = createCutDelta(packed);
  let asked = 0,
    revision = 0,
    refused = new Set<PageRec>();
  const pending = createCutPending(
    packed,
    delta,
    (rec) => (asked++, !refused.has(rec)),
    () => revision,
  );
  delta.apply([0, 1, 2, 3]);
  pending.apply();
  assert.equal(pending.count, 4);
  asked = 0;
  for (let read = 0; read < 10; read++) assert.equal(pending.count, 4);
  assert.equal(asked, 0, 'a still frame rereads nothing');
  refused = new Set([packed[3]]);
  revision++;
  assert.equal(pending.count, 3, 'the pool refused a record: the list follows');
  assert.equal(asked, 4);
});

test('a dependency named only by a cut record moves it; one outside the cut moves nothing', () => {
  const packed = world(),
    delta = createCutDelta(packed);
  const pending = createCutPending(packed, delta);
  delta.apply([1]);
  pending.apply();
  assert.deepEqual(pending.records, [packed[1]]);
  // Its bundle arrives: the record it waited on is complete with its own bytes.
  packed[0].array = new Uint32Array(3);
  packed[1].array = new Uint32Array(3);
  pending.touch(0);
  pending.touch(1);
  assert.equal(pending.count, 0);
  // Its bundle leaves again: the cut's dependent is reread.
  packed[0].array = undefined;
  pending.touch(0);
  assert.deepEqual(pending.records, [packed[1]]);
  // Record 3 is out of the cut: its bundle arriving names nothing.
  packed[2].array = new Uint32Array(3);
  pending.touch(2);
  assert.deepEqual(pending.records, [packed[1]]);
});

test('its tables follow the cut: the same cut in a larger catalogue weighs the same', () => {
  const bytes = (records: number) => {
    const packed = Array.from({ length: records }, (_, id) => ({ url: `p${id}`, packedIndex: id }));
    const delta = createCutDelta(packed as unknown as PageRec[]),
      pending = createCutPending(packed as unknown as PageRec[], delta);
    delta.apply([0, 1, 2, 3]);
    pending.apply();
    return delta.hostBytes + pending.hostBytes;
  };
  assert.equal(bytes(64 * 16), bytes(64));
});
