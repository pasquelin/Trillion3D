// The compute raster draws the hardware raster's image, to the silhouette, whether it takes the
// whole cut (`raster-compute`) or the small triangles alone (`raster-hybrid`): twelve tilted tiles,
// each two triangles sharing a diagonal in two clusters, a face-on tile whose 45° diagonal goes
// through pixel centres, a huge tile whose diagonal crosses the image from vertices thousands of
// pixels off-screen, and a tile across the near plane. No pixel may differ off the silhouette band
// — no crack between neighbouring triangles, no stray triangle, no triangle neither raster took
// (`computeRasterPage.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { preuveDansLaPage, preuveSaine } from '../kit/enginePageProof.ts';

type Reading = Awaited<ReturnType<typeof import('./computeRasterPage.ts').compareRasters>>;

test('the compute raster is watertight under both variants', async () => {
  const result = await preuveDansLaPage(
    resolve(import.meta.dirname, 'computeRasterPage.ts'),
    'computeRaster',
    'compareRasters',
  );
  const { adaptateur: adapter, covered, clusters, variants } = result as Reading;
  console.log(JSON.stringify({ adapter, covered, clusters, variants }));
  preuveSaine(result);
  assert.ok((covered ?? 0) > 1000, `the scene covers only ${covered} pixels`);
  assert.equal(clusters, 30);
  for (const [variant, { clusters: drawn, interior, silhouette }] of Object.entries(
    variants ?? {},
  )) {
    assert.equal(drawn, 30, `${variant}: both rasters draw the same cut`);
    assert.deepEqual(interior, [], `${variant}: pixels differ off the silhouette band`);
    // The two fill rules may differ by one pixel on the silhouette, never by more than its length.
    assert.ok(
      silhouette < (covered ?? 0) / 8,
      `${variant}: ${silhouette} silhouette pixels differ`,
    );
  }
});
