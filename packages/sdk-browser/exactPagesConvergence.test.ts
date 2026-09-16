// Pose immobile, cache qui applique les arrivées : la coupe doit converger vers UNE couverture et
// cesser de demander. Deux couvertures équivalentes se relayaient au gré des arrivées, avec des
// requêtes permanentes — l'anneau de préchargement, demandé même quand la coupe visible était
// incomplète, se disputait le cache avec ce que l'image montre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from './index.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';

/** Le moteur Three sur la fixture DAG, sans aucune page en mémoire au départ. */
function moteur() {
  const fixture = dagFixture();
  const backend = exactPagesBackend({
    source: fixture.source,
    metadata: fixture.metadata,
    indices: new Map<string, Uint32Array>(),
    associations: fixture.associations,
    pixelError: 0.05,
    viewport: [1280, 720] as [number, number],
  });
  return { backend, octets: fixture.indices, dispose: () => fixture.geometry.dispose() };
}

/** La couverture affichée, dans l'ordre : c'est elle qui doit être un point fixe. */
const couverture = (backend: ReturnType<typeof exactPagesBackend>) =>
  backend.scene.children
    .filter((child) => child.type === 'Mesh')
    .map((child) => child.uuid)
    .join(',');

/** Une image : coupe, puis arrivée de ce que le moteur a demandé, comme un cache qui répond. */
function image(
  backend: ReturnType<typeof exactPagesBackend>,
  octets: Map<string, Uint32Array>,
  camera = wideCamera(),
) {
  backend.render(camera);
  const demandes = [...backend.pendingUrls!(), ...backend.prefetchUrls!()];
  for (const url of demandes) {
    const bytes = octets.get(url);
    if (bytes) backend.acceptPage!(url, bytes);
  }
  backend.syncResident!();
  return demandes;
}

test('pose immobile : la coupe converge vers une couverture et cesse de demander', () => {
  const { backend, octets, dispose } = moteur();
  const camera = wideCamera();
  // Dix images suffisent largement à drainer une hiérarchie de sept pages.
  for (let i = 0; i < 10; i++) image(backend, octets, camera);
  const converge = backend.metrics().clusters;
  const couvertures = new Set<string>();
  let demandesApres = 0;
  for (let i = 0; i < 8; i++) {
    demandesApres += image(backend, octets, camera).length;
    couvertures.add(couverture(backend));
    assert.equal(backend.metrics().clusters, converge, 'le nombre de clusters a changé');
  }
  assert.equal(couvertures.size, 1, `la coupe alterne entre ${couvertures.size} couvertures`);
  assert.equal(demandesApres, 0, 'le moteur demande encore alors que sa coupe est complète');
  backend.dispose();
  dispose();
});

test('l’anneau de préchargement ne se dispute pas le cache avec la coupe visible', () => {
  const { backend, octets, dispose } = moteur();
  const camera = wideCamera();
  backend.render(camera);
  assert.ok(backend.pendingUrls!().length > 0, 'la coupe visible doit être incomplète ici');
  assert.deepEqual(
    backend.prefetchUrls!(),
    [],
    'l’anneau est demandé alors que l’image montre encore des trous : il pousse dehors ce que ' +
      'l’image attend, la coupe retombe sur un remplaçant plus grossier, et rien ne converge',
  );
  // Une fois la coupe visible complète, l'anneau reprend son rôle : précharger le voisinage.
  for (let i = 0; i < 10; i++) image(backend, octets, camera);
  assert.deepEqual(backend.pendingUrls!(), [], 'la coupe visible est complète');
  backend.dispose();
  dispose();
});
