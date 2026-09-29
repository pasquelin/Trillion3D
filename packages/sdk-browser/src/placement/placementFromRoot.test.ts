// #1226 step A: a page record carries no placement values. Every reader takes the world, the row
// and the winding from the root its `placementIndex` names, so a placement is no longer copied
// into each of its pages — the step before one record per primitive (#1235).
// #1233 step B1: the cut publishes its instances as packed catalogue ranks, and the consumers read
// a record back through the one accessor, `recordOf`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PAGE_INFO_STRIDE } from '../visibility/buffer.ts';
import { placedSession, scaleDown } from './webgpuGrowth.fixture.ts';
import { selectVisiblePages } from '../page/selection/selection.ts';
import { createEngineCamera } from '../camera/world.ts';
import { faceEngineCamera } from '../webgpu/shadow/cpuCasters.ts';
import { sunRun } from '../webgpu/shadow/runs.fixture.ts';

type Session = Awaited<ReturnType<typeof placedSession>>;

/** What the image is drawn from: the rows, the draw items, the corners and the cut. */
function digest({ rt }: Session) {
  const { rows, drawItemWords, cornerPacked } = rt.layout;
  const hash = createHash('sha256');
  // #33 fills former padding with physical-surface fields; the placement oracle compares
  // the original row contract, leaving those independently tested material words out.
  const originalWords = 64,
    stride = PAGE_INFO_STRIDE / 4;
  const table = new Float32Array((rows.pageTableFloats!.length / stride) * originalWords);
  for (let row = 0; row < table.length / originalWords; row++)
    table.set(
      rows.pageTableFloats!.subarray(row * stride, row * stride + originalWords),
      row * originalWords,
    );
  for (let row = 0; row < table.length; row += originalWords)
    for (const word of [38, 39, 40, 41, 44, 45, 52, 53, 58, 59]) table[row + word] = 0;
  for (const words of [table, rows.packedPageIndex, drawItemWords, cornerPacked])
    hash.update(new Uint8Array(words.buffer, words.byteOffset, words.byteLength));
  const ranks = (list: readonly { packedIndex?: number }[]) => list.map((rec) => rec.packedIndex);
  hash.update(JSON.stringify([rows.packedCount, ranks(rt.run.shown), ranks(rt.run.desired)]));
  return hash.digest('hex').slice(0, 16);
}

/**
 * The shadow casters of the scene, as the light cut selects them: the CPU cut reads a face as a
 * camera and its pages as the light's extent (`../webgpu/shadow/cpuCasters.ts`). The casters ARE
 * that cut's shown list, published as packed ranks; this resolves them through the catalogue.
 */
function casterDigest({ rt }: Session) {
  const run = sunRun(1024),
    viewport: [number, number] = [64, 64],
    cam = faceEngineCamera(run, createEngineCamera(), viewport);
  const selected = selectVisiblePages(rt.setup.roots, cam, {
    pixelError: run.uniforms.pixelError,
    viewport,
    held: rt.services.heldResidency,
    light: run.pages,
  });
  const hash = createHash('sha256'),
    url = (packed: number) => rt.layout.recordOf(packed)?.url ?? '?';
  for (const packed of selected.shownPacked) hash.update(`s${packed}:${url(packed)};`);
  hash.update('|');
  for (const packed of selected.wantedPacked) hash.update(`w${packed}:${url(packed)};`);
  return hash.digest('hex').slice(0, 16);
}

/** The session at open, once its core node moved every placement under it, once grown. */
async function steps() {
  const session = await placedSession(5);
  const { core, cells, io, draw } = session;
  try {
    const seen = [digest(session)],
      casters = [casterDigest(session)];
    core.position.set(0.5, 10, -0.25);
    core.rotation.set(0, 0.3, 0);
    for (let frame = 0; frame < 2; frame++) cells.frame([0, 0, 0], 100, io, noBudget);
    await draw();
    await draw();
    seen.push(digest(session));
    casters.push(casterDigest(session));
    scaleDown(session);
    await draw();
    await draw();
    seen.push(digest(session));
    casters.push(casterDigest(session));
    const pages = session.rt.layout.packedPages;
    return { seen, casters, pages };
  } finally {
    session.dispose();
  }
}
const noBudget = { admits: () => true, spend() {} };

test('a page record carries no world, row or winding: its root does', async () => {
  const { pages } = await steps();
  assert.ok(pages.length > 3, 'repeated placements, grown ones included');
  for (const page of pages)
    for (const field of ['matrix', 'placement', 'windingCw', 'windingEpoch'])
      assert.ok(!(field in page), `${page.url} carries no ${field}`);
});

test('rows, draw items and cut of repeated and moved placements are those of develop', async () => {
  // Recorded on develop at 9e1e03681, where every page carried its placement's world and row.
  assert.deepEqual((await steps()).seen, [
    'a050b5ea5ef71dfe',
    'e016c9549e4d6b3e',
    '7f19c3513fc55ccd',
  ]);
});

test('the shadow casters of repeated and moved placements are those of develop', async () => {
  // The light cut runs over the same placements, from a sun's face; its casters are packed ranks.
  assert.deepEqual((await steps()).casters, [
    '525271fd6218f01a',
    '525271fd6218f01a',
    '525271fd6218f01a',
  ]);
});
