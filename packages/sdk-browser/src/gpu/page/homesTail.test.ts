// S31: the two reads of a page that are not a quantized decode stay inside the page's own home:
// the corner words of a page the cache gave no geometry page, and the deformation tails, which keep
// their offset past the widest page and raise the home to their end (`../../deformation/slotLayout.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { PAGE_POINTS_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts';
import { deformationSlotBytes, deformOutputWord } from '../../deformation/slotLayout.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { pageHomes } from './homes.ts';

type Fn = (...args: unknown[]) => unknown;
/** Words before the page: its first word is never the pool's. */
const BASE = 3;

test('an index page and a deformation tail are read inside their own home', () => {
  const words = new Map<number, number>(),
    past: number[] = [];
  let end = 0;
  const indices = new Proxy([], {
    get: (_, key) => {
      const i = Number(key);
      if (i >= end) past.push(i);
      return words.get(i) ?? 0;
    },
  });
  const run = shaderRun<Record<string, Fn>>(
    PAGE_POINTS_WGSL,
    ['pageTriangle', 'pageCorner', 'pageDeformed'],
    { indices, positions: [] },
  );
  // A page the cache gave no geometry page: a word a corner, its home its own bytes.
  const corners = [0, 1, 2, 2, 1, 3];
  corners.forEach((corner, i) => words.set(BASE + i, corner));
  end = BASE + corners.length;
  const row = { flags: 0, pageOffset: BASE, deformOutput: 0 };
  for (let tri = 0; tri < 2; tri++)
    assert.deepEqual(run.pageTriangle(row, {}, tri), corners.slice(tri * 3, tri * 3 + 3));
  for (let corner = 0; corner < 6; corner++)
    assert.equal(run.pageCorner(row, {}, corner), corners[corner]);
  // Two placements of a deformed page: their tails past the widest page, in the home they raise.
  const placements = [0, 1].map(
    () =>
      ({
        url: 'a',
        geometryPage: { url: 'a', vertexCount: 3 },
        sourceMesh: { morphTargetInfluences: [0] },
      }) as unknown as PageRec,
  );
  const widths = new Map([['a', 16]]);
  deformationSlotBytes(placements, 64, [], widths);
  end = BASE + pageHomes(widths)!.homes.get('a')!.bytes / 4;
  for (const { deformationOutput } of placements)
    for (let v = 0; v < 3; v++)
      for (const field of [0, 3, 6])
        run.pageDeformed({ deformOutput: deformOutputWord(deformationOutput, BASE) }, v, field);
  assert.deepEqual(past, []);
});
