// #1232: the CPU cut counts every row it selects, the table holding them or not: that count, not the
// placements, is what the table grows to (`../pages/prepare/growTables.ts`, `followCutRows`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuRowState } from './state.ts';
import { image, mount, offsetsPar } from './commit.fixture.ts';
import { catalogue, mount as mountCasters } from './blendCasters.fixture.ts';

test('a cut that selects more rows than the table holds says how many it selected', () => {
  const mounted = mount((pages) => createWebgpuRowState(pages, 2));
  image(mounted, { offsets: offsetsPar((page) => page * 16), coupeProcesseur: true });
  // Pages 0, 1, 3 and 5 draw (2 waits for its bytes, 4 is blended): two rows hold two of them.
  assert.equal(mounted.rows.packedCount, 2);
  assert.equal(mounted.sync.rowsAsked(), 4);
});

test('a caster left without a row is asked once, however often the table is written again', () => {
  // Two blended casters on one caster row: the second waits for the table to grow.
  const { rows, casters } = mountCasters([...catalogue(0.4), ...catalogue(0.6)], 1);
  for (let image = 0; image < 3; image++) {
    rows.tableEpoch++;
    casters.refresh();
  }
  assert.equal(casters.used, 1);
  assert.equal(casters.asked, 2, 'the row in use and the one caster waiting');
  // The waiting caster leaves residency: nothing is asked for it any more.
  rows.residentOffsetWords[3] = -1;
  casters.follow(3);
  assert.equal(casters.asked, 1);
});
