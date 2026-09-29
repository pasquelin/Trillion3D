// #1275 part B: the GPU maps the pages a frame asks for, in that frame, and the host pool follows
// its snapshots. Run from the shipped WGSL over a mock device (`gpuFrames.fixture.ts`), the
// scheduling is the same whether the readback comes back each frame or is withheld: the GPU maps
// the same pages, the host draws what it learns, and no page ever reads another entry's depth.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneLight, ShadowViewpoint } from '../../../../sdk-core/src/index.ts';
import {
  LAMP,
  SUN,
  VIEW,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import type { ShadowRequestReport } from '../../../../sdk-core/src/scene/light-shadow/requests.ts';
import {
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  PAGE_VALID,
  SHADOW_TABLE_STRIDE,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { gpuFrames } from './gpuFrames.fixture.ts';
import { floorTiles, tileGrid } from './shadingReads.fixture.ts';

const tiles = floorTiles(tileGrid(-4, 4, -14, -6), 3);
/** Frame `f`: the camera sliding sideways, looking down the floor, and the lamp turning over it. */
const viewAt = (f: number): ShadowViewpoint => ({
  ...VIEW,
  position: [f * 0.4 - 3, 4, 2],
  forward: [0, -0.3, -0.954],
});
const lampAt = (f: number): Partial<SceneLight> => ({
  position: [3 * Math.cos(f / 3), 3, -10 + 3 * Math.sin(f / 3)],
  range: 20,
});
const MOVING = 8,
  STILL = 3;

/**
 * `MOVING` frames of a moving camera and lamp, then `STILL` at rest, over a pool of 100 pages that
 * one frame's reads fit and the moving frames' do not. Each report reaches the plan at the next
 * frame, or, `withheld`, none before the scene rests. Returns, frame by frame, the entry each GPU
 * page maps, then the last frame's reads and their words.
 */
async function schedule(withheld: boolean) {
  const run = gpuFrames(10, [SUN, { ...LAMP, ...lampAt(0) }]),
    { plan, store, table, owner, drawnFor } = run,
    inbox: ShadowRequestReport[] = [],
    identity: number[][] = [];
  let read: number[] = [];
  for (let frame = 1; frame <= MOVING + STILL; frame++) {
    if (!withheld || frame > MOVING) for (const report of inbox.splice(0)) plan.receive(report);
    const at = Math.min(frame, MOVING);
    store.set('lamp', lampAt(at));
    read = await run.frame(frame, viewAt(at), tiles.lits, (report) => inbox.push(report));
    identity.push([...owner]);
    // No page reads another entry's depth: a word readable names a page drawn for its entry.
    owner.forEach((entry, page) => {
      if (entry >= 0 && table[entry] & PAGE_VALID)
        assert.equal(drawnFor[page], entry, `page ${page} at ${frame}`);
    });
    // Every page the frame read is mapped in that frame, whatever the host has read back.
    for (const entry of read) assert.ok(table[entry] & PAGE_MAPPED, `${entry} at ${frame}`);
    if (withheld && frame === MOVING) assert.equal(plan.requests.latest, -1, 'nothing read back');
  }
  return { identity, read, words: read.map((entry) => table[entry]) };
}

test('with the readback withheld, the GPU maps the pages the readback path maps, and draws them', async () => {
  const back = await schedule(false),
    withheld = await schedule(true);
  assert.ok(back.read.length > 50, 'the frame reads pages of both lights');
  // The pool is full while the view moves: pages go to other entries, least recently asked first.
  const given = back.identity
    .slice(1)
    .map((owners, f) =>
      owners.some((entry, page) => entry >= 0 && ![-1, entry].includes(back.identity[f][page])),
    );
  assert.ok(given.includes(true), 'the GPU evicts');
  // Page identity: the same entry in the same page, frame by frame, moving and at rest.
  back.identity.forEach((owners, frame) =>
    assert.deepEqual(withheld.identity[frame], owners, `identity at frame ${frame + 1}`),
  );
  // Validity: once the reports land, every page the image reads is drawn, in the same page.
  assert.deepEqual(withheld.words, back.words);
  for (const word of back.words) assert.ok(word & PAGE_VALID, `page ${word & PAGE_INDEX_MASK}`);
});

test('a lamp removed frees its pages on the GPU: the lamp its slice goes to reads none of them', async () => {
  const run = gpuFrames(10, [{ ...LAMP, ...lampAt(0) }]),
    { plan, store, table, owner } = run,
    inbox: ShadowRequestReport[] = [];
  const frame = (at: number) => {
    for (const report of inbox.splice(0)) plan.receive(report);
    return run.frame(at, viewAt(0), tiles.lits, (report) => inbox.push(report));
  };
  for (let at = 1; at < 5; at++) await frame(at);
  const slice = store.sliceOf(0),
    base = plan.table.baseOf(slice),
    ofSlice = () =>
      [...owner].filter((entry) => entry >= base && entry < base + SHADOW_TABLE_STRIDE);
  assert.ok(
    ofSlice().some((entry) => table[entry] & PAGE_VALID),
    'the lamp reads drawn pages',
  );
  // Another lamp takes its slice in the same frame, its entries the same words of the table.
  store.remove('lamp');
  store.add({ ...LAMP, id: 'other', position: [1, 2, -11] });
  const read = await frame(5);
  assert.equal(store.sliceOf(0), slice);
  assert.ok(read.length > 0 && ofSlice().length > 0, 'the new lamp is mapped');
  for (const entry of ofSlice()) assert.equal(table[entry] & PAGE_VALID, 0, `entry ${entry}`);
});
