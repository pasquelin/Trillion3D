// Les deux sommes de triangles sont tenues à la retenue, plus balayées après la coupe. Elles
// doivent rester, terme pour terme et dans le même ordre, celles des tableaux rendus — y compris
// quand un repli raccourcit `shown` puis le reremplit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages, selectVisiblePages, type PageRec } from './pageSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { cameraMoteur } from './cameraFixture.ts';

/** La somme que les balayages d'avant ce lot calculaient : de gauche à droite, sans réassociation. */
function sum(pages: readonly PageRec[]) {
  let total = 0;
  for (let i = 0; i < pages.length; i++) total += pages[i].triangles;
  return total;
}

test('les sommes de triangles rendues sont celles des tableaux rendus, repli compris', () => {
  const fixture = dagFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const cam = wideCamera();
  // Chaque sous-ensemble résident : la coupe demandée, celle qu'on peut montrer, les replis par
  // groupe forcé et la couverture de secours passent tous par ce produit.
  let vus = 0,
    replis = 0;
  for (let mask = 0; mask < 1 << allPages.length; mask += 7)
    for (const pixelError of [0, 0.5, 4])
      for (const rootFallback of [false, true]) {
        const wanted: PageRec[] = [];
        const result = selectVisiblePages(roots, cameraMoteur(cam), {
          pixelError,
          viewport: [1280, 720],
          holdResident: true,
          rootFallback,
          isResident: (page) => ((mask >> allPages.indexOf(page)) & 1) === 1,
          wanted,
        });
        vus++;
        if (result.shown.length !== result.wanted.length) replis++;
        assert.ok(
          Object.is(result.displayedTriangles, sum(result.shown)),
          `triangles affichés, masque ${mask}, seuil ${pixelError}`,
        );
        assert.ok(
          Object.is(
            result.selectedTriangles,
            result.wanted.length ? sum(result.wanted) : sum(result.shown),
          ),
          `triangles demandés, masque ${mask}, seuil ${pixelError}`,
        );
      }
  assert.ok(vus > 100, `seulement ${vus} coupes`);
  assert.ok(replis > 0, 'aucune coupe où `shown` et `wanted` divergent');
});

test('le budget de pages ne fausse pas les sommes du passage retenu', () => {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const cam = wideCamera();
  for (const pageBudget of [1, 2, 3, 5, 8]) {
    const wanted: PageRec[] = [];
    const result = selectVisiblePages(roots, cameraMoteur(cam), {
      pixelError: 0,
      viewport: [1280, 720],
      holdResident: true,
      pageBudget,
      wanted,
    });
    assert.ok(Object.is(result.displayedTriangles, sum(result.shown)), `budget ${pageBudget}`);
    assert.ok(
      Object.is(
        result.selectedTriangles,
        result.wanted.length ? sum(result.wanted) : sum(result.shown),
      ),
      `budget ${pageBudget}, demandés`,
    );
  }
});
