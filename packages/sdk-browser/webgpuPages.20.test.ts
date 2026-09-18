import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { MODE_DEPTH_OCCLUDER, MODE_DEPTH_REST, MODE_ID, rasterEntry } from './gpuRasterContract.ts';
import { drawnPageIds, installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

// Le raster de calcul ne se crée que sous `raster-calcul` ou `raster-hybride` : la coupe part alors
// au calcul — binning, profondeur des occulteurs, du reste, identifiants — entre les passes du
// matériel, qui ouvrent l'image. C'est le côté calcul du banc bit à bit (Géométrie 26, point 3).
test('la variante raster-calcul confie toute la coupe au raster de calcul', async () => {
  installGpuGlobals();
  const fixture = quadScene();
  const { source, metadata, indices, associations } = fixture;
  const collected = collectClusterPages(source, metadata, indices, associations);
  const packed = packDagSelection(collected.roots);
  const { device, draws, computes, buffers } = mockGpu(undefined, packed);
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    diagnosticDetail: 'trace',
    diagnosticGpuVariant: 'raster-calcul',
  });
  await backend.prepare();
  backend.render(camera());
  await backend.flush?.();
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
  // Les passes matérielles s'encodent toujours : ce sont elles qui ouvrent l'image, et leurs
  // commandes indirectes restent — c'est l'étage de sommets qui replie ce que le calcul prend.
  assert.ok(draws.some((draw) => draw.indirect));
  // Les deux résolutions du calcul, chacune un triangle plein écran : la pyramide et l'image close.
  assert.equal(draws.filter((draw) => draw.entryPoint === 'vs').length, 2);
  // Ce raster prend toute la coupe : ce n'est pas celui de la référence, et il ne le déclare pas.
  assert.ok(backend.capabilities.unsupported.includes('small-triangle compute raster'));
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});
