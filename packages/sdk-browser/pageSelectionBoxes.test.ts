// Le comportement changé par ce lot : une racine déclare une fois que chacune de ses pages porte sa
// boîte, et la coupe cesse de le vérifier par cluster sous un nœud entièrement dans le tronc. La
// déclaration est un contrat ; ces trois tests en tiennent les deux bouts — qui l'écrit, qui la lit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages, selectVisiblePages, type PageRec } from './pageSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { dagCulling } from './pageSelectionTestHelpers.ts';
import { blendFixture } from './pageSelectionBlendFixture.ts';
import type { ClusterRoot } from './pageSelectionTypes.ts';

const ASK = { pixelError: 0, viewport: [1280, 720] as [number, number], holdResident: true };

/** Le DAG de test avec sa hiérarchie, dont la caméra large voit la racine entière : la descente y
 *  pose `inside` dès le premier nœud, et c'est le seul cas où la déclaration change quelque chose. */
function racines() {
  const fixture = dagFixture();
  fixture.metadata.primitives[0].culling = dagCulling();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  return { fixture, roots };
}

const montres = (roots: ReadonlyArray<ClusterRoot<PageRec>>) =>
  selectVisiblePages(roots, wideCamera(), ASK).shown.map((page) => page.url);

test('la collecte déclare des boîtes, ce qui est vrai de toutes ses pages', () => {
  const fixture = blendFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.ok(roots.length > 0);
  for (const root of roots) assert.equal(root.boxes, true);
  for (const page of allPages) {
    assert.equal(page.min.length, 3);
    assert.equal(page.max.length, 3);
  }
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('déclarer des boîtes ne change aucune coupe quand chaque page porte la sienne', () => {
  const { fixture, roots } = racines();
  const declare = montres(roots);
  roots[0].boxes = undefined;
  assert.deepEqual(montres(roots), declare);
  assert.ok(declare.length > 0);
  fixture.geometry.dispose();
});

test('sans déclaration, une page sans boîte est écartée ; déclarée, la coupe ne la lit plus', () => {
  const { fixture, roots } = racines();
  const sansBoite = roots[0].pages[0];
  sansBoite.min = undefined as unknown as number[];
  sansBoite.max = undefined as unknown as number[];
  roots[0].boxes = undefined;
  assert.ok(!montres(roots).includes(sansBoite.url));
  // La déclaration est crue : la page passe sans que sa boîte soit lue. C'est ce que le contrat
  // achète, et ce qui rend une omission visible plutôt que silencieuse.
  roots[0].boxes = true;
  assert.ok(montres(roots).includes(sansBoite.url));
  fixture.geometry.dispose();
});
