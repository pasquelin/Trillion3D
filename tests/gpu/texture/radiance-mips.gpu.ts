// The radiance mip chain on the GPU (`texture/mipBatch.ts`, `createRadianceMipChain`): the
// reduction the reflections read, run on HDR images whose last level is read back — even and odd
// sizes, one corner texel brighter and transparent.
//
//   node bench/dawn/proofs.ts tests/gpu/texture/radiance-mips.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('the radiance reduction keeps HDR means, alpha and an odd edge energy', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'radianceMipsPage.ts'),
    'radianceMipsPage',
  )) as typeof import('./radianceMipsPage.ts')
  const { values, errors } = await runOnDawn(() => page.run(), null)
  assert.deepEqual(errors, [])
  // Each image is (1, 2, 4, 1) but its corner texel, (16, 32, 64, 0) on the odd ones: the last
  // level holds the mean over the image's `count` texels.
  const counts = [0, 35, 9, 9]
  counts.forEach((count, row) => {
    const expected = count
      ? [1 + 15 / count, 2 + 30 / count, 4 + 60 / count, 1 - 1 / count]
      : [1, 2, 4, 1]
    values[row].forEach((value, channel) =>
      assert.ok(
        Math.abs(value - expected[channel]) <= expected[channel] / 512,
        `image ${row}, channel ${channel}: ${value} against ${expected[channel]}`,
      ),
    )
  })
})
