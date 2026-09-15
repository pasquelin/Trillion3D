// Le comportement changé par ce lot : une racine déclare ses cônes une fois pour toutes, et la
// coupe croit cette déclaration au lieu de lire `cone` sur chaque cluster retenu. La déclaration
// est donc un contrat, et ces trois tests en tiennent les deux bouts — qui l'écrit, qui la lit.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectClusterPages, selectVisiblePages, type PageRec } from './pageSelection.ts';
import { blendFixture, camera } from './pageSelectionBlendFixture.ts';
import type { ClusterRoot } from './pageSelectionTypes.ts';

/** Une fixture dont la page la plus proche porte un cône qui regarde à l'opposé de la caméra :
 *  honoré, il la rejette ; ignoré, elle reste. Le matériau est à une seule face, sans quoi le rejet
 *  de cône n'a rien à dire. */
function fixtureAvecCone() {
  const fixture = blendFixture(new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  collected.allPages[0].cone = { axis: [0, 0, -1], angle: 0 };
  return { fixture, ...collected };
}

function urls(roots: ReadonlyArray<ClusterRoot<PageRec>>) {
  return selectVisiblePages(roots, camera(), {}).shown.map((page) => page.url);
}

test('la collecte déclare une racine sans cône, ce qui est vrai de toutes ses pages', () => {
  const fixture = blendFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.ok(roots.length > 0);
  for (const root of roots) assert.equal(root.cones, false);
  for (const page of allPages) assert.equal(page.cone, undefined);
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('une racine qui déclare porter des cônes rejette par son cône, comme avant ce lot', () => {
  const { fixture, roots } = fixtureAvecCone();
  // `true` et le silence disent la même chose : teste chaque page. Le second est ce que rendait
  // toute racine avant ce lot, et c'est la réponse d'avant qui doit revenir.
  roots[0].cones = true;
  const declare = urls(roots);
  roots[0].cones = undefined;
  assert.deepEqual(urls(roots), declare);
  assert.ok(!declare.includes('near'));
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('une racine qui déclare n’avoir aucun cône ne lit plus `cone` : le cluster est retenu', () => {
  const { fixture, roots } = fixtureAvecCone();
  roots[0].cones = false;
  assert.ok(urls(roots).includes('near'));
  fixture.geometry.dispose();
  fixture.material.dispose();
});
