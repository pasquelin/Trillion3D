// Côté Three : une image tenue n'exécute aucune coupe. Sa durée de coupe et son nombre de nœuds
// visités valaient encore ceux de la dernière image qui en avait fait une ; ils valent désormais
// zéro. Ce que l'image montre — pages retenues, triangles sélectionnés, rejet par le tronc — reste
// celui de la coupe réaffichée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from './index.ts';
import { quadRootsContext, frontCamera } from './pagesBackendScenes.ts';

function moteur() {
  const { geometry, material, context } = quadRootsContext(true);
  return {
    backend: exactPagesBackend(context),
    camera: frontCamera(),
    dispose: () => (geometry.dispose(), material.dispose()),
  };
}

test('pose immobile : l’image finit par être tenue, et la coupe qu’elle montre ne bouge pas', () => {
  const { backend, camera, dispose } = moteur();
  backend.render(camera);
  const premiere = backend.metrics();
  assert.equal(premiere.frameHeld, false, 'la première image fait tout le travail');
  let tenue;
  for (let i = 0; i < 4 && !tenue; i++) {
    backend.render(camera);
    const m = backend.metrics();
    if (m.frameHeld) tenue = m;
  }
  assert.ok(tenue, 'une pose immobile n’a jamais convergé vers une image tenue');
  assert.equal(tenue.clusters, premiere.clusters, 'la coupe réaffichée est la même');
  assert.equal(tenue.selectedTriangles, premiere.selectedTriangles);
  assert.equal(tenue.frustumRejected, premiere.frustumRejected);
  assert.equal(tenue.lodLevel, premiere.lodLevel);
  backend.dispose();
  dispose();
});

test('une image tenue ne republie pas la durée de coupe de l’image qui en a fait une', () => {
  const { backend, camera, dispose } = moteur();
  let tenue;
  for (let i = 0; i < 5 && !tenue; i++) {
    backend.render(camera);
    const m = backend.metrics();
    if (m.frameHeld) tenue = m;
  }
  assert.ok(tenue, 'aucune image tenue');
  assert.equal(tenue.cpuSelectMs, 0, 'aucune coupe n’a tourné sur cette image');
  assert.equal(tenue.cpuSelectNodesTested, 0, 'aucun nœud n’a été visité');
  backend.dispose();
  dispose();
});
