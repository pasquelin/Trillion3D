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
import { keptRows } from './freshRun.fixture.ts';
import { gpuFrames } from './gpuFrames.fixture.ts';
import { floorTiles, tileGrid, type Lit } from './shadingReads.fixture.ts';

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

/** Whether `P` lies outside the vertical field of `view`: above or below it, or behind the eye. */
function offCamera(view: ShadowViewpoint, P: readonly number[]) {
  const f = view.forward,
    d = P.map((c, a) => c - view.position[a]);
  const along = d[0] * f[0] + d[1] * f[1] + d[2] * f[2],
    level = Math.hypot(f[0], f[2]);
  // The view's up axis, for a forward with no roll.
  const up = [(-f[0] * f[1]) / level, level, (-f[2] * f[1]) / level];
  const rise = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
  return along <= 0 || Math.abs(rise / along) > Math.tan(view.halfFovY);
}

test('a caster the camera does not see keeps its pages over a receiver it sees', async () => {
  const forward = [0, -0.3, -0.954].map((c) => c / Math.hypot(0.3, 0.954)) as [
    number,
    number,
    number,
  ];
  const view: ShadowViewpoint = { ...VIEW, position: [0, 1, -2], forward };
  const receiver: Lit = { P: [0, 0, -10], N: [0, 1, 0] };
  // Two metres above the receiver, under the lamp and the overhead sun: out of the camera's field.
  const caster = { center: [0, 4, -10], radius: 0.3 },
    aside = { center: [9, 4, 6], radius: 0.3 };
  assert.ok(offCamera(view, caster.center) && !offCamera(view, receiver.P));
  const lamp: SceneLight = { ...LAMP, position: [0, 6, -10] };
  for (const light of [SUN, lamp]) {
    const run = gpuFrames(16, [light]);
    const read = await run.frame(1, view, [receiver], () => {});
    assert.ok(read.length > 0, `${light.kind}: the receiver reads pages`);
    for (const entry of read) {
      // Mapped, drawn and readable in the frame the receiver asks for it.
      const word = run.table[entry],
        page = word & PAGE_INDEX_MASK,
        region = run.regions.indexOf(page);
      assert.ok(word & PAGE_VALID && region >= 0, `${light.kind}: entry ${entry} drawn`);
      assert.deepEqual(
        keptRows(run.batch[1], region, [caster, aside]),
        [0],
        `${light.kind}: page ${page} keeps the caster over its receiver, and it alone`,
      );
    }
  }
});
