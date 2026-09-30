// #1226 step A: a page record carries no placement values. Every reader takes the world, the row
// and the winding from the root its `placementIndex` names, so a placement is no longer copied
// into each of its pages — the step before one record per primitive (#1235).
// #1233 step B1: the cut publishes its instances as packed catalogue ranks, and the consumers read
// a record back through the one accessor, `recordOf`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PAGE_INFO_STRIDE } from '../visibility/buffer.ts';
import { DRAW_INDIRECT_WORDS } from '../gpu/draw/contract.ts';
import { placedSession, scaleDown } from './webgpuGrowth.fixture.ts';
import { armCasters } from './casters.fixture.ts';
import { createEngineCamera } from '../camera/world.ts';
import { rootOf } from '../page/selection/placements.ts';
import { selectCpuCasters, writeCpuCasters } from '../webgpu/shadow/cpuCasters.ts';
import type { PageRec } from '../page/selection/selection.ts';

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
  // The instances as packed ranks, rank by rank (#1235): a record serves every placement.
  hash.update(
    JSON.stringify([
      rows.packedCount,
      rt.run.shownPacked.slice(0, rt.run.shown.length),
      rt.run.desiredPacked.slice(0, rt.run.desired.length),
    ]),
  );
  return hash.digest('hex').slice(0, 16);
}

/**
 * The shadow casters of the scene, as the REAL CPU caster pipeline produces them: for each light
 * face, `selectCpuCasters` runs the cut from the light over the packed catalogue, keeping the
 * face's WHOLE cut in `shownPacked` and only the pages no row already draws in `casters`; then
 * `writeCpuCasters` turns those packed ranks into the row words and commands the shadow pass binds.
 * Everything is resolved through `recordOf`: the face ranks by URL, the casters by URL, the words
 * as written, and the bases, lengths and commands as they stand.
 */
function casterDigest({ rt }: Session) {
  const disarm = armCasters(rt);
  const device = rt.gpu.device!;
  selectCpuCasters(rt, device, createEngineCamera());
  writeCpuCasters(rt, device);
  const lists = rt.lights.cpuCasters!,
    hash = createHash('sha256'),
    url = (packed: number) => rt.layout.recordOf(packed)?.url ?? '?';
  // The placement a packed rank names lives in its root (#1226): its world is hashed too, so a
  // moved or grown placement shows through the same cut.
  const world = (packed: number) =>
    [12, 13, 14]
      .map((i) =>
        (
          rootOf(rt.layout.selectionRoots, rt.layout.placement.rootOfPacked[packed]).world.elements[
            i
          ] ?? 0
        ).toFixed(3),
      )
      .join(',');
  for (let r = 0; r < lists.runs; r++) {
    hash.update(`f${r}{`);
    for (const packed of lists.shownPacked[r])
      hash.update(`${packed}:${url(packed)}:${rt.layout.recordOf(packed) ? world(packed) : '?'};`);
    hash.update('}');
  }
  hash.update('|c');
  for (const packed of lists.castersPacked) hash.update(`${packed}:${url(packed)};`);
  const written = Array.from({ length: lists.runs }, (_, r) => lists.lengths[r]).reduce(
    (a, b) => a + b,
    0,
  );
  hash.update(`|w${written}:`);
  for (let i = 0; i < written; i++) hash.update(`${lists.words[i]};`);
  hash.update(`|b${Array.from(lists.bases.subarray(0, lists.runs)).join(',')}`);
  hash.update(`|l${Array.from(lists.lengths.subarray(0, lists.runs)).join(',')}`);
  hash.update(
    `|k${Array.from(lists.commands.subarray(0, lists.runs * DRAW_INDIRECT_WORDS)).join(',')}`,
  );
  const digest = hash.digest('hex').slice(0, 16);
  disarm();
  return digest;
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

test('a page record carries no world, row, winding, placement or packed rank: its root does', async () => {
  const session = await placedSession(5);
  try {
    const { allPages, collectedRoots, metadata } = session;
    // #1235: ONE record per primitive page. `develop` built one per (placement, page); here the
    // open's records equal the primitives' pages (3 at the fixture's 3 one-page primitives),
    // whatever the rows later grow to.
    const primitivePages = metadata.primitives.reduce(
      (n, primitive) => n + primitive.pages.length,
      0,
    );
    assert.equal(
      allPages.length,
      primitivePages,
      'one record per primitive page, not per placement',
    );
    // Every placement of a primitive shares its one `pages` array: one distinct array per primitive.
    assert.equal(
      new Set(collectedRoots.map((root) => root.pages)).size,
      metadata.primitives.length,
      'the placements of a primitive share their pages array',
    );
    for (const page of allPages)
      for (const field of [
        'matrix',
        'placement',
        'windingCw',
        'windingEpoch',
        'placementIndex',
        'packedIndex',
      ])
        assert.ok(!(field in page), `${page.url} carries no ${field}`);
  } finally {
    session.dispose();
  }
});

test('rows, draw items and cut of repeated and moved placements are those of develop', async () => {
  // Recorded on develop at 9e1e03681, where every page carried its placement's world and row.
  assert.deepEqual((await steps()).seen, [
    'a050b5ea5ef71dfe',
    'e016c9549e4d6b3e',
    '7f19c3513fc55ccd',
  ]);
});

test('each light face keeps its whole cut, and only the deduped casters leave it', async () => {
  const session = await placedSession(5),
    { rt } = session;
  const disarm = armCasters(rt);
  try {
    selectCpuCasters(rt, rt.gpu.device!, createEngineCamera());
    const lists = rt.lights.cpuCasters!,
      face0 = new Set(lists.shownPacked[0]),
      face1 = new Set(lists.shownPacked[1]),
      drawn = new Set(rt.run.drawnPacked.slice(0, rt.run.drawn.length));
    assert.ok(face0.size > 0 && face1.size > 0, 'both faces select from the light');
    const shared = [...face0].filter((page) => face1.has(page) && drawn.has(page));
    assert.ok(shared.length > 0, 'a camera-visible caster is shared by the two faces');
    const casters = new Set(lists.castersPacked);
    for (const page of shared)
      assert.ok(!casters.has(page), 'a shared caster stays out of casters');
  } finally {
    disarm();
    session.dispose();
  }
});

test('the shadow casters of repeated and moved placements are those of develop', async () => {
  // Recorded on develop at 9dc777745 with the same two sun faces and the same digest: the real
  // `selectCpuCasters` + `writeCpuCasters` run over the packed catalogue, and the values are the
  // ones develop produced when its cut published records instead of packed ranks.
  assert.deepEqual((await steps()).casters, [
    'c1cf4fb83cc9597f',
    '2ac3fab00ccd05c7',
    'db14422dda586392',
  ]);
});
