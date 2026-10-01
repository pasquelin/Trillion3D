// #831: a page the GPU mapped and drew itself is drawn once, as the reference engine draws a page: the host adopts
// it current, never redrawing it until what it holds changes; one the GPU mapped without a draw
// waits for the host's, as before. A mover over the kept page then draws it whole, layer and all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowMirror, type ShadowPoolSnapshot } from './mirror.ts';
import { DRAW_FULL, STALE_DYNAMIC } from './pool.ts';
import { sunPages, sunScene } from './lightShadow.fixture.ts';

function adopted(gpuDrawn: boolean) {
  const { plan, slice } = sunScene(),
    { table, pool, records, sun } = plan,
    mirror = createShadowMirror(table, pool, records, sun),
    [entry] = sunPages(plan, slice, sun.finest[slice] + 6, [[0, 0]]);
  const owner = new Int32Array(pool.pages).fill(-1);
  for (let page = 0; page < pool.pages; page++) owner[page] = pool.owner[page];
  const page = owner.indexOf(-1);
  owner[page] = entry;
  const snapshot: ShadowPoolSnapshot = {
    owner,
    requested: new Int32Array(pool.pages).fill(1),
    gpuDrawn: new Uint8Array(pool.pages),
    allocated: 1,
    refused: 0,
    drawn: 1,
    listings: 1,
  };
  snapshot.gpuDrawn![page] = +gpuDrawn;
  mirror.set(true, 0);
  const followed = mirror.follow(
    {
      frame: 0,
      layoutEpoch: table.layoutEpoch,
      stamp: 0,
      count: 0,
      entries: new Uint32Array(0),
      pool: snapshot,
    },
    16,
    1,
  );
  assert.ok(followed, 'the snapshot is followed');
  assert.equal(pool.owner[page], entry);
  return { pool, page, range: sun.ranges.current[slice] };
}

test('a page the GPU drew is adopted current, without its static layer', () => {
  const { pool, page, range } = adopted(true);
  assert.equal(pool.dirty[page], 0, 'not drawn again by the host');
  assert.equal(pool.valid[page], 1);
  assert.equal(pool.layered[page], 0);
  assert.equal(pool.range[page], range);
  // A mover over it: drawn whole, static layer first, then the mover over it.
  pool.stale(page, 32, 2, STALE_DYNAMIC);
  assert.equal(pool.drawMode(page, true, range), DRAW_FULL);
});

test('a page the GPU mapped and did not draw waits for the host', () => {
  const { pool, page } = adopted(false);
  assert.ok(pool.dirty[page] > 0, 'stale');
  assert.equal(pool.valid[page], 0);
});
