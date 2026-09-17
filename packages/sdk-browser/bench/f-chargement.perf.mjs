// F16 et F17 : le chargement d'une scène.
import * as THREE from 'three';
import { collectClusterPages } from '../pageSelectionCollect.ts';
import { exactPagesBounds } from '../exactPagesBounds.ts';
import { indexManifestBundles, indexManifestPages } from '../manifestPageIndex.ts';
import { mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { referenceCollectClusterPages } from './oracles/f-chargement.mjs';
import {
  referenceExactPagesBounds,
  referenceIndexManifestBundles,
  referenceIndexManifestPages,
} from './oracles/f-scene.mjs';
import { manifesteEtScene } from './scenesF.mjs';

const boiteVersTableau = (boite) =>
  boite.isBox3 ? [...boite.min.toArray(), ...boite.max.toArray()] : Array.from(boite);

const grande = manifesteEtScene({ primitives: 200, pages: 12, triangles: 8 });
const petite = manifesteEtScene({ primitives: 1, pages: 1, triangles: 1, seed: 77 });
const orpheline = manifesteEtScene({ primitives: 3, pages: 2, triangles: 2, seed: 99 });
for (const mesh of orpheline.associations.keys()) orpheline.associations.set(mesh, undefined);
const videMetadata = { primitives: [] };
const videScene = {
  source: new THREE.Group(),
  associations: new Map(),
  metadata: videMetadata,
  indices: new Map(),
};

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
  keyIndex: rec.keyIndex,
  packedIndex: rec.packedIndex,
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
      ...boiteVersTableau(root.localBox),
      ...boiteVersTableau(root.worldBox),
    ]),
    bornes: sortie.roots.map((root) => root.culling?.bounds ?? null),
  };
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

const resCollect = await mesure({
  nom: 'F16 collecte des pages de clusters',
  fichier: 'packages/sdk-browser/pageSelectionCollect.ts',
  cas,
  calcul: passeCollect(collectClusterPages),
  attendu: passeCollect(referenceCollectClusterPages),
  options: { tours: 40, budgetMs: 1500 },
});

const resIndex = await mesure({
  nom: 'F17 indexation du manifeste',
  fichier: 'packages/sdk-browser/manifestPageIndex.ts',
  cas: [
    { nom: '2 400 pages', entree: grande.metadata, taille: 2400 },
    { nom: 'une page', entree: petite.metadata, taille: 1 },
  ],
  calcul: passeIndex(indexManifestPages, indexManifestBundles),
  attendu: passeIndex(referenceIndexManifestPages, referenceIndexManifestBundles),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  nom: 'exactPagesBounds extremes',
  calcul: (scene) => exactPagesBounds(scene.source, scene.associations, scene.metadata),
  extremes: [{ nom: 'vide', entree: videScene }],
});

rapport(
  'f-chargement',
  [resCollect, resIndex],
  'F16 et F17 retrouvent exactement les mêmes pages, index et boîtes',
);
