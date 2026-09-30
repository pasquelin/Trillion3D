// #1344: a surface that lands at rest — a cube streamed in under a still camera — asks pages no
// frame mapped. The GPU maps them in that frame, and draws them only in a frame that runs its page
// draws (`freshWanted`); the image may hold only once none is left mapped and undrawn
// (`shadowsUnsettled`). Run from the shipped WGSL over a mock device (`gpuFrames.fixture.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
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
import { shadowsUnsettled } from '../pages/state/lights.ts';
import { gpuFrames } from './gpuFrames.fixture.ts';
import { floorTiles, tileGrid } from './shadingReads.fixture.ts';

const view = { ...VIEW, position: [0, 4, 2], forward: [0, -0.3, -0.954] } as typeof VIEW;
/** The floor seen at rest, and the surface that lands on it later, nearer the eye. */
const floor = floorTiles(tileGrid(-4, 4, -14, -10), 3),
  landed = floorTiles(tileGrid(-2, 2, -6, -3), 3);

/** The scene over the mock GPU, the loop drawing while the shadows are unsettled (`settle`). */
function restScene() {
  const run = gpuFrames(16, [SUN, { ...LAMP, position: [0, 3, -8], range: 20 }], 'wanted'),
    { plan, store } = run,
    inbox: ShadowRequestReport[] = [],
    lights = { plan, store, shadows: {}, pageRequests: { inFlight: 0 } } as never,
    lits = [...floor.lits],
    scene = { run, lits, frame: 0, read: [] as number[] };
  const draw = async () => {
    for (const report of inbox.splice(0)) plan.receive(report);
    scene.read = await run.frame(++scene.frame, view, lits, (report) => inbox.push(report));
  };
  /** What the loop does: a frame while the shadows are unsettled, then the image holds. */
  const settle = async () => {
    const from = scene.frame;
    await draw();
    for (const report of inbox.splice(0)) plan.receive(report);
    while (shadowsUnsettled(lights) && scene.frame < from + 32) await draw();
    assert.ok(scene.frame < from + 32, 'the image comes to rest');
  };
  return Object.assign(scene, { settle });
}

/** Every page the image reads is drawn, with its own entry's depth. */
function drawnAtRest({ run, read }: ReturnType<typeof restScene>) {
  const { table, owner, drawnFor } = run;
  for (const entry of read) {
    assert.ok(table[entry] & PAGE_VALID, `entry ${entry} read undrawn at rest`);
    assert.equal(drawnFor[table[entry] & PAGE_INDEX_MASK], entry, `entry ${entry}`);
  }
  owner.forEach((entry, page) => {
    if (entry >= 0 && table[entry] & PAGE_MAPPED)
      assert.ok(table[entry] & PAGE_VALID || !read.includes(entry), `page ${page} undrawn`);
  });
}

test('after rest, no shadow page is mapped and undrawn, a surface landed at rest included', async () => {
  const scene = restScene();
  await scene.settle();
  // The surface lands: the camera and the world stay still.
  const before = scene.run.table.slice();
  scene.lits.push(...landed.lits);
  await scene.settle();
  const first = scene.read.filter((entry) => !(before[entry] & PAGE_MAPPED));
  assert.ok(first.length > 0, 'the landed surface asks pages no frame mapped');
  drawnAtRest(scene);
});

test('a page withdrawn at rest is drawn again, read on or read again later', async () => {
  const scene = restScene(),
    { plan, drawnAt } = scene.run;
  scene.lits.push(...landed.lits);
  await scene.settle();
  const pages = scene.read.map((entry) => scene.run.table[entry] & PAGE_INDEX_MASK);
  // A light cut drew them short: stale, and withdrawn until drawn again (`redrawShortPages`).
  const withdraw = () => {
    for (const page of pages) {
      plan.pool.stale(page, scene.frame * 16, scene.frame);
      plan.pool.withdraw(plan.table, page);
    }
    return scene.frame;
  };
  const at = withdraw();
  await scene.settle();
  drawnAtRest(scene);
  for (const page of pages) assert.ok(drawnAt[page] > at, `page ${page} drawn again`);
  // Withdrawn while the surface is gone, then read again.
  scene.lits.length = floor.lits.length;
  withdraw();
  await scene.settle();
  scene.lits.push(...landed.lits);
  await scene.settle();
  drawnAtRest(scene);
});
