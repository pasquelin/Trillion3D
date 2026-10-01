// #1275: the pages the GPU maps and draws in the frame that asks for them, run from the shipped
// WGSL over a mock device (`gpuFrames.fixture.ts`): with the camera and the lamp moving, every page
// a frame reads first is drawn in that frame, before anything samples it — no one-frame hole —,
// where without the GPU's draws it waits for its report; and a caster the camera does not see,
// over a receiver it sees, is kept by the page's own light-space cull, its page drawn in the frame.
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
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { shadowPagesPerFrame } from '../../gpu/shadow/batchBudget.ts';
import { gpuFrames } from './gpuFrames.fixture.ts';
import { floorTiles, tileGrid } from './shadingReads.fixture.ts';

const tiles = floorTiles(tileGrid(-4, 4, -14, -6), 3);
/** Frame `f` of the move: the camera sliding sideways over the floor, the lamp circling above it. */
const viewAt = (f: number): ShadowViewpoint => ({
  ...VIEW,
  position: [f * 0.2 - 2, 4, 2],
  forward: [0, -0.3, -0.954],
});
const lampAt = (f: number): Partial<SceneLight> => ({
  position: [3 * Math.cos(f / 12), 3, -10 + 3 * Math.sin(f / 12)],
  range: 20,
});
const REST = 4,
  MOVING = 8;

/**
 * `REST` frames at rest, then `MOVING` frames of the move, each report reaching the plan the next
 * frame. Returns, per moving frame, the pages it needs first — unmapped when it starts — and those
 * of its reads not readable when it samples them.
 */
async function move(gpuDraws: boolean) {
  const run = gpuFrames(16, [SUN, { ...LAMP, ...lampAt(0) }], gpuDraws),
    { plan, store, table, drawnFor, drawnAt } = run,
    inbox: ShadowRequestReport[] = [],
    frames: { first: number[]; holes: number[] }[] = [];
  for (let frame = 1; frame <= REST + MOVING; frame++) {
    for (const report of inbox.splice(0)) plan.receive(report);
    const at = Math.max(0, frame - REST),
      before = table.slice();
    store.set('lamp', lampAt(at));
    const read = await run.frame(frame, viewAt(at), tiles.lits, (report) => inbox.push(report));
    const first = read.filter((entry) => !(before[entry] & PAGE_MAPPED)),
      holes = read.filter((entry) => !(table[entry] & PAGE_VALID));
    if (frame === REST) assert.deepEqual(holes, [], 'at rest, every page read is drawn');
    if (frame <= REST) continue;
    frames.push({ first, holes });
    // A page readable holds its own entry's depth; one needed first was drawn in this very frame.
    for (const entry of read) {
      const page = table[entry] & PAGE_INDEX_MASK;
      if (table[entry] & PAGE_VALID) assert.equal(drawnFor[page], entry, `entry ${entry}`);
      if (gpuDraws && first.includes(entry)) assert.equal(drawnAt[page], frame, `entry ${entry}`);
    }
  }
  return frames;
}

test('with the camera and the lamp moving, a page first read in a frame is drawn in it', async () => {
  const drawn = await move(true);
  assert.ok(
    drawn.some(({ first }) => first.length > 0),
    'the moving frames need pages no frame mapped before',
  );
  drawn.forEach(({ holes }, f) => assert.deepEqual(holes, [], `moving frame ${f + 1}`));
  // Without the GPU's draws the same pages are mapped in the frame and drawn once their report
  // lands: the moving frames read pages not drawn yet.
  const waited = await move(false);
  assert.ok(
    waited.some(({ holes }) => holes.length > 0),
    'without them, a frame reads what it maps',
  );
});

test('at a cold start, every page the first frame reads is drawn in it, within its page budget', async () => {
  const run = gpuFrames(16, [SUN, { ...LAMP, ...lampAt(0) }]),
    before = run.table.slice();
  const read = await run.frame(1, viewAt(0), tiles.lits, () => {});
  const first = read.filter((entry) => !(before[entry] & PAGE_MAPPED));
  // More than a batch of the host's regions holds: the GPU draws past it, as its pair list allows,
  // up to the pages it maps a frame (#831), past which they wait for the next.
  assert.ok(first.length > MAX_SHADOW_REGIONS, `${first.length} pages first read`);
  assert.ok(first.length <= shadowPagesPerFrame(run.plan.pool.pages), 'within the budget');
  assert.deepEqual(
    read.filter((entry) => !(run.table[entry] & PAGE_VALID)),
    [],
  );
  for (const entry of first) assert.equal(run.drawnAt[run.table[entry] & PAGE_INDEX_MASK], 1);
});
