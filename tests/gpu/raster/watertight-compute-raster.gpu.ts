// The cluster split draws the hardware raster's image, to the silhouette, at its default threshold
// and at 64 px, which hands the software raster every tile but the huge one and the one across the
// near plane: twelve tilted
// tiles, each two triangles sharing a diagonal in two clusters, a face-on tile whose 45° diagonal
// goes through pixel centres, a huge tile whose diagonal crosses the image from vertices thousands
// of pixels off-screen, and a tile across the near plane. No pixel may differ off the silhouette
// band — no crack between neighbouring triangles, no stray triangle, no cluster neither raster took
// (`computeRasterPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../../kit/device/enginePageProof.ts'

type Reading = Awaited<ReturnType<typeof import('./computeRasterPage.ts').compareRasters>>

test('the cluster split is watertight at both thresholds', async () => {
  const result = await runPageProof(
    resolve(import.meta.dirname, 'computeRasterPage.ts'),
    'computeRaster',
    'compareRasters',
  )
  const { adapter: adapter, covered, clusters, variants } = result as Reading
  console.log(JSON.stringify({ adapter, covered, clusters, variants }))
  assertSoundProof(result)
  assert.ok((covered ?? 0) > 1000, `the scene covers only ${covered} pixels`)
  assert.equal(clusters, 30)
  for (const [variant, { clusters: drawn, interior, silhouette }] of Object.entries(
    variants ?? {},
  )) {
    assert.equal(drawn, 30, `${variant}: both rasters draw the same cut`)
    assert.deepEqual(interior, [], `${variant}: pixels differ off the silhouette band`)
    // The two fill rules may differ by one pixel on the silhouette, never by more than its length.
    assert.ok(silhouette < (covered ?? 0) / 8, `${variant}: ${silhouette} silhouette pixels differ`)
  }
})
