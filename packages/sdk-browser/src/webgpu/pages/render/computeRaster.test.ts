import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODE_DEPTH_OCCLUDER,
  MODE_DEPTH_REST,
  MODE_ID,
  rasterEntry,
} from '../../../gpu/raster/contract.ts';
import { drawnPageIds, installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { quadScene, camera, disposeQuadRun, flushedGpuScene } from '../testScenes.fixture.ts';

// The compute raster is created only under `raster-calcul` or `raster-hybride`: the cut then goes
// to compute — binning, occluder depth, the rest, identifiers — between the hardware passes that
// open the image. That is the compute side of the bit-exact bench (Geometry 26, point 3).
test('the raster-calcul variant hands the whole cut to the compute raster', async () => {
  installGpuGlobals();
  const fixture = quadScene();
  const { draws, computes, buffers, packed, backend } = await flushedGpuScene(fixture, {
    diagnosticDetail: 'trace',
    diagnosticGpuVariant: 'raster-calcul',
  });
  draws.length = 0;
  computes.length = 0;
  backend.render(camera());
  assert.deepEqual(drawnPageIds(buffers, packed.nodeCount, packed.pageCount), [0, 1]);
  const at = (entry: string) => computes.indexOf(entry);
  const bin = at('bin'),
    occluder = at(rasterEntry('fine', MODE_DEPTH_OCCLUDER)),
    rest = at(rasterEntry('fine', MODE_DEPTH_REST)),
    ids = at(rasterEntry('fine', MODE_ID));
  assert.ok(bin >= 0 && occluder > bin && rest > occluder && ids > rest);
  // Hardware passes always encode: they open the image, and their indirect commands remain — it is
  // the vertex stage that folds what compute takes.
  assert.ok(draws.some((draw) => draw.indirect));
  // The two compute resolves, each a full-screen triangle: the pyramid and the closed image.
  assert.equal(draws.filter((draw) => draw.entryPoint === 'vs').length, 2);
  // This raster takes the whole cut: it is not the reference's, and it does not claim to be.
  assert.ok(backend.capabilities.unsupported.includes('small-triangle compute raster'));
  disposeQuadRun(backend, fixture);
});
