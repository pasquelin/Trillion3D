// loading a scene.
import * as THREE from 'three';
import { collectClusterPages } from '../../../packages/sdk-browser/pageSelectionCollect.ts';
import { exactPagesBounds } from '../../../packages/sdk-browser/exactPagesBounds.ts';
import {
  indexManifestBundles,
  indexManifestPages,
} from '../../../packages/sdk-browser/manifestPageIndex.ts';
import { mesure, stress, rapport } from '../../core/index.ts';
import type { PageRec } from '../../../packages/sdk-browser/pageSelectionTypes.ts';
import { referenceCollectClusterPages } from '../../oracles/browser/collecte-pages.ts';
import {
  referenceExactPagesBounds,
  referenceIndexManifestBundles,
  referenceIndexManifestPages,
} from '../../oracles/browser/bornes-et-index.ts';
import { manifesteEtScene } from './support/scenesChargement.ts';
import { DEFAULT_SCOPE, type ClusterManifest } from '../../../packages/sdk-core/index.ts';

const boiteVersTableau = (boite: THREE.Box3 | ArrayLike<number>): number[] =>
  'isBox3' in boite && boite.isBox3
    ? [...boite.min.toArray(), ...boite.max.toArray()]
    : Array.from(boite as ArrayLike<number>);

type ChargementScene = ReturnType<typeof manifesteEtScene>;

const grande = manifesteEtScene({ primitives: 200, pages: 12, triangles: 8 });
const petite = manifesteEtScene({ primitives: 1, pages: 1, triangles: 1, seed: 77 });
const orpheline = manifesteEtScene({ primitives: 3, pages: 2, triangles: 2, seed: 99 });
// Simulates a mesh without a prepared primitive: `.get(mesh)` reads `undefined` either way,
// and nothing here reads `.has(mesh)` — deleting the key keeps the map's own value type.
for (const mesh of orpheline.associations.keys()) orpheline.associations.delete(mesh);
const videMetadata: ClusterManifest = {
  schema: 0,
  status: 'ready',
  key: 'bench-empty',
  scope: DEFAULT_SCOPE,
  sourceTriangles: 0,
  selectedTriangles: 0,
  selectedNodes: [],
  totalNodes: 0,
  primitives: [],
};
const videScene: ChargementScene = {
  source: new THREE.Group(),
  associations: new Map(),
  metadata: videMetadata,
  indices: new Map(),
};

const recDe = (rec: PageRec) => ({
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

const passeCollect =
  (fn: typeof collectClusterPages | typeof referenceCollectClusterPages) =>
  (input: ChargementScene) => {
    let output;
    try {
      output = fn(input.source, input.metadata, input.indices, input.associations);
    } catch (erreur) {
      return { refus: erreur instanceof Error ? erreur.message : String(erreur) };
    }
    return {
      refus: null,
      requestCount: output.requestCount,
      prepared: output.prepared,
      blendCopies: output.blendCopies.length,
      bootstrap: output.bootstrap.length,
      pages: output.allPages.map(recDe),
      boites: output.roots.flatMap((root) => [
        ...boiteVersTableau(root.localBox ?? new Float64Array(6)),
        ...boiteVersTableau(root.worldBox ?? new Float64Array(6)),
      ]),
      bornes: output.roots.map((root) => root.culling?.bounds ?? null),
    };
  };

const passeBounds =
  (fn: typeof exactPagesBounds | typeof referenceExactPagesBounds) => (input: ChargementScene) => {
    const manquants: string[] = [];
    const boite = fn(input.source, input.associations, input.metadata, (mesh) =>
      manquants.push(mesh.name),
    );
    return { boite: boiteVersTableau(boite), manquants };
  };

const passeIndex =
  (pages: typeof indexManifestPages, bundles: typeof indexManifestBundles) =>
  (metadata: import('../../../packages/sdk-core/index.ts').ClusterManifest) => {
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
  { name: '200 primitives, 2 600 pages', input: grande, size: 2600 },
  { name: 'one primitive, one page', input: petite, size: 1 },
  { name: 'mesh without a primitive', input: orpheline, size: 3 },
  { name: 'empty scene', input: videScene, size: 0 },
];

const resCollect = await mesure({
  name: 'cluster page collection',
  fichier: 'packages/sdk-browser/pageSelectionCollect.ts',
  cas,
  calcul: passeCollect(collectClusterPages),
  attendu: passeCollect(referenceCollectClusterPages),
  options: { tours: 40, budgetMs: 1500 },
});

const resBounds = await mesure({
  name: 'exact page bounds',
  fichier: 'packages/sdk-browser/exactPagesBounds.ts',
  cas,
  calcul: passeBounds(exactPagesBounds),
  attendu: passeBounds(referenceExactPagesBounds),
  options: { tours: 40, budgetMs: 1500 },
});

const resIndex = await mesure({
  name: 'manifest indexing',
  fichier: 'packages/sdk-browser/manifestPageIndex.ts',
  cas: [
    { name: '2 400 pages', input: grande.metadata, size: 2400 },
    { name: 'one page', input: petite.metadata, size: 1 },
  ],
  calcul: passeIndex(indexManifestPages, indexManifestBundles),
  attendu: passeIndex(referenceIndexManifestPages, referenceIndexManifestBundles),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'exactPagesBounds extremes',
  calcul: (scene: ChargementScene) =>
    exactPagesBounds(scene.source, scene.associations, scene.metadata, () => {}),
  extremes: [{ name: 'empty', input: videScene }],
});

rapport(
  'chargement-scene',
  [resCollect, resBounds, resIndex],
  'F16 and F17 recover the exact same pages, indices and boxes',
);
