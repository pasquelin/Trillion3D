// F16 et F17 : le chargement d'une scène. F16 retrouve la primitive d'un maillage par une table au
// lieu d'un `find` qui parcourait tout le manifeste, concatène les index dans un `Uint32Array` de
// taille connue au lieu d'un tableau JS de millions de nombres, et fait l'union des boîtes en
// scalaires. F17 parcourt les pages du manifeste une seule fois et réutilise une boîte de travail.
import * as THREE from 'three';
import { collectClusterPages } from '../../../packages/sdk-browser/pageSelectionCollect.ts';
import { exactPagesBounds } from '../../../packages/sdk-browser/explorerScene.ts';
import {
  indexManifestBundles,
  indexManifestPages,
} from '../../../packages/sdk-browser/manifestPageIndex.ts';
import { compare } from './banc.mjs';
import { verifieEtDeposeF } from './bancF.mjs';
import { referenceCollectClusterPages } from './oracles/f-chargement.mjs';
import {
  referenceExactPagesBounds,
  referenceIndexManifestBundles,
  referenceIndexManifestPages,
} from './oracles/f-scene.mjs';
import { manifesteEtScene } from './scenesF.mjs';

const grande = manifesteEtScene({ primitives: 200, pages: 12, triangles: 8 });
const petite = manifesteEtScene({ primitives: 1, pages: 1, triangles: 1, seed: 77 });
/** Une scène dont aucun maillage n'a de primitive : les deux côtés doivent refuser au même endroit. */
const orpheline = manifesteEtScene({ primitives: 3, pages: 2, triangles: 2, seed: 99 });
for (const mesh of orpheline.associations.keys()) orpheline.associations.set(mesh, undefined);
const videMetadata = { primitives: [] };
const videScene = {
  source: new THREE.Group(),
  associations: new Map(),
  metadata: videMetadata,
  indices: new Map(),
};

/** Ce qu'un enregistrement de page doit rendre identique : tout ce qui n'est pas un objet Three.js. */
const recDe = (rec) => ({
  id: rec.id,
  url: rec.url,
  clusterId: rec.clusterId,
  array: rec.array,
  triangles: rec.triangles,
  indexBytes: rec.indexBytes,
  min: rec.min,
  max: rec.max,
  role: rec.role,
  level: rec.level,
  lodError: rec.lodError,
  sphere: rec.sphere,
  parentError: rec.parentError,
  parentSphere: rec.parentSphere,
  group: rec.group,
  source: rec.source,
  streamUrl: rec.streamUrl,
  streamOffset: rec.streamOffset,
  depthLayer: rec.depthLayer,
  transparent: rec.transparent,
  sourceOrder: rec.sourceOrder,
  renderOrder: rec.renderOrder,
  requestIndex: rec.requestIndex,
});

const passeCollect = (fn) => (entree) => {
  let sortie;
  try {
    sortie = fn(entree.source, entree.metadata, entree.indices, entree.associations);
  } catch (erreur) {
    return { refus: erreur.message };
  }
  return {
    refus: null,
    requestCount: sortie.requestCount,
    prepared: sortie.prepared,
    blendCopies: sortie.blendCopies.length,
    bootstrap: sortie.bootstrap.length,
    pages: sortie.allPages.map(recDe),
    boites: sortie.roots.flatMap((root) => [
      ...root.localBox.min.toArray(),
      ...root.localBox.max.toArray(),
      ...root.worldBox.min.toArray(),
      ...root.worldBox.max.toArray(),
    ]),
    bornes: sortie.roots.map((root) => root.culling?.bounds ?? null),
  };
};

const passeBounds = (fn) => (entree) => {
  const manquants = [];
  const boite = fn(entree.source, entree.associations, entree.metadata, (mesh) =>
    manquants.push(mesh.id),
  );
  return { boite: [...boite.min.toArray(), ...boite.max.toArray()], manquants };
};

const passeIndex = (pages, bundles) => (metadata) => {
  const index = pages(metadata);
  return {
    pages: index.pages.map((page) => page.url),
    identifiants: index.pages.map((page) => page.id),
    geometryPages: index.geometryPages.map((page) => page.url),
    geometryUrls: index.geometryUrls,
    pageIdByUrl: index.pageIdByUrl,
    bundles: bundles(metadata).map((bundle) => bundle.url),
  };
};

const cas = [
  { nom: '200 primitives, 2 600 pages', entree: grande, taille: 2600 },
  { nom: 'une primitive, une page', entree: petite, taille: 1 },
  { nom: 'maillage sans primitive', entree: orpheline, taille: 3 },
  { nom: 'scène vide', entree: videScene, taille: 0 },
];

const lignes = [
  await compare({
    calcul: 'F16 collecte des pages de clusters',
    fichier: 'packages/sdk-browser/pageSelectionCollect.ts',
    cas,
    reference: passeCollect(referenceCollectClusterPages),
    optimisee: passeCollect(collectClusterPages),
    options: { chauffe: 3, tours: 200, budgetMs: 4000 },
  }),
  await compare({
    calcul: 'F17 bornes des pages exactes',
    fichier: 'packages/sdk-browser/explorerScene.ts',
    cas,
    reference: passeBounds(referenceExactPagesBounds),
    optimisee: passeBounds(exactPagesBounds),
    options: { chauffe: 5, tours: 200, budgetMs: 3000 },
  }),
  await compare({
    calcul: 'F17 index des pages du manifeste',
    fichier: 'packages/sdk-browser/manifestPageIndex.ts',
    cas: [
      { nom: '200 primitives, 2 600 pages', entree: grande.metadata, taille: 2600 },
      { nom: 'une seule page', entree: petite.metadata, taille: 1 },
      { nom: 'manifeste vide', entree: videMetadata, taille: 0 },
    ],
    reference: passeIndex(referenceIndexManifestPages, referenceIndexManifestBundles),
    optimisee: passeIndex(indexManifestPages, indexManifestBundles),
    options: { chauffe: 5, tours: 200, budgetMs: 3000 },
  }),
];

verifieEtDeposeF(
  'f-chargement',
  'F16 et F17 rendent exactement les mêmes pages, boîtes et index',
  lignes,
);
