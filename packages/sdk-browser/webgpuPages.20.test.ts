import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { MODE_DEPTH_OCCLUDER, MODE_DEPTH_REST, MODE_ID, rasterEntry } from './gpuRasterContract.ts';
import { drawnPageIds, installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

// Géométrie 26 : le raster de calcul ne se crée que sous la variante `raster-calcul`. Sans elle,
// le matériel dessine et aucun noyau de raster n'est lancé ; avec elle, la même coupe part au
// calcul — binning, profondeur des occulteurs, du reste, identifiants — et aucune commande
// matérielle ne porte de géométrie. C'est le côté « calcul » du banc bit à bit de l'étape 2.
test('la variante raster-calcul confie la coupe au raster de calcul, et elle seule', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const packed = packDagSelection(collected.roots);
  const { device, draws, computes, buffers } = mockGpu(undefined, packed);
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
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
  assert.equal(draws.filter((draw) => draw.indirect).length, 0);
  assert.ok(draws.every((draw) => draw.vertexCount === 3));
  // Ce raster prend toute la coupe : ce n'est pas celui de la référence, et il ne le déclare pas.
  assert.ok(backend.capabilities.unsupported.includes('small-triangle compute raster'));
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
