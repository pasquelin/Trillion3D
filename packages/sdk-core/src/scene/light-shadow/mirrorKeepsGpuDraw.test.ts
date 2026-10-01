// #831: a page the GPU mapped and drew itself is drawn once, as Unreal draws a page: the host adopts
// it current, never redrawing it until what it holds changes; one the GPU mapped without a draw
// waits for the host's, as before. A mover over a page kept without a static layer draws it whole,
// layer and all; over one whose GPU draw filled its static layer, only its moving casters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowMirror, type ShadowPoolSnapshot } from './mirror.ts';
import { DRAW_DYNAMIC, DRAW_FULL, STALE_DYNAMIC } from './pool.ts';
import { sunPages, sunScene } from './lightShadow.fixture.ts';

function adopted(gpuDrawn: boolean, layered = false) {
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
  // The GPU's draws wrote the static layer since a snapshot before this one (`freshPass.ts`).
  if (layered) {
    mirror.drew(0, true);
    const before = { ...snapshot, owner: pool.owner.slice(), gpuDrawn: undefined };
    const at = { frame: 0, layoutEpoch: table.layoutEpoch, stamp: 0, count: 0 };
    assert.ok(mirror.follow({ ...at, entries: new Uint32Array(0), pool: before }, 16, 1));
  }
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

test('a page the GPU drew with its static layer is restored when a mover crosses it', () => {
  const { pool, page, range } = adopted(true, true);
  assert.equal(pool.layered[page], 1, 'its still casters are in the static layer');
  pool.stale(page, 32, 2, STALE_DYNAMIC);
  assert.equal(
    pool.drawMode(page, true, range),
    DRAW_DYNAMIC,
    'its static casters not drawn again',
  );
});
