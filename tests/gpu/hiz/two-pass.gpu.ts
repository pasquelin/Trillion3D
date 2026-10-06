// The two-phase Hi-Z withdraws what the previous image's pyramid hides, and a still view under
// the antialiasing jitter converges to a held image. A wall and a slab behind it: seen beside the
// wall, the slab is drawn and becomes an occluder; hidden behind it, its rows are withdrawn from
// the occluders by the previous pyramid, rejected by this image's (`hizRejectedClusters > 0`), and
// the image is held within the limit. Every held image equals a fresh engine's at the same pose,
// pixel for pixel, temporal antialiasing on (`twoPassPage.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts';

type Reading = Awaited<ReturnType<typeof import('./twoPassPage.ts').runTwoPass>>;

test('the previous pyramid withdraws, this one rejects, and the still view holds', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'twoPassPage.ts'),
    'hizTwoPass',
    'runTwoPass',
  )) as Reading;
  console.log(JSON.stringify({ adapter: reading.adapter, steps: reading.steps }));
  assertSoundProof(reading);
  const [beside, hidden, again] = reading.steps;
  for (const { x, images, gap, rows } of reading.steps) {
    assert.ok(images !== null, `at x=${x}, the still view was never held`);
    assert.equal(
      gap,
      0,
      `at x=${x}, the held image differs from a fresh engine's on ${gap} pixels`,
    );
    assert.ok((rows ?? 0) > 0, `at x=${x}, the partition processed no row`);
  }
  assert.ok(beside.slab > 0, 'beside the wall, the slab is seen');
  assert.equal(hidden.slab, 0, 'behind the wall, the slab is hidden');
  assert.ok(again.slab > 0, 'beside the wall again, the slab is seen again');
  // Rows drawn beside the wall, then hidden: only the previous pyramid's withdrawal takes an
  // occluder to the tested half, and this image's pyramid then rejects it. A history that only
  // grows would have kept the slab an occluder, drawn behind the wall and never tested. The
  // withdrawal lasts one image and the counters are sampled one image in fifteen: it is published,
  // the rejection it leads to is asserted.
  assert.equal(beside.rejected, 0, 'beside the wall, nothing is hidden and nothing rejected');
  assert.ok(hidden.rejected > 0, 'behind the wall, the rows drawn before were never rejected');
});
