import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { meshes as objects } from './sceneMeshes.ts';
import { assertFiniteTransform } from './hostWorldMatrices.ts';
import { hostWorldChainInto } from './hostWorldChain.ts';
import { exactPagesBounds, exactPagesLot } from './exactPagesBounds.ts';
import { replicateInstances } from './replicateInstances.ts';
import { hostBoundsLot, hostWorldBounds } from './hostWorldBounds.ts';
import { hostWorldLot } from './hostWorldTree.ts';
import { EngineError, MATRIX_VALUES, type ClusterManifest } from '../sdk-core/index.ts';
import { createMultiplyLot } from './mathBatchRuntime.ts';
import { prepareMathBatch } from './mathBatchState.ts';
import type { BackendContext, ExplorerOptions } from './backendTypes.ts';
import type { ExplorerEmitters } from './explorerSession.ts';
import { checked } from './clusterPages.ts';
import { bakedImageUrls, PLACEHOLDER_IMAGE } from './sceneTextureSkip.ts';

/** La matrice monde d'un maillage au chargement, reprise d'un maillage à l'autre. */
const monde = new Float64Array(MATRIX_VALUES);

/** Un maillage de la scène préparée sans pages de géométrie : la scène autonome est incomplète. */
function manquante(): never {
  throw new EngineError(
    'AUTONOMOUS_ASSOCIATION_MISSING',
    'Prepared scene primitive has no geometry pages',
  );
}

/** Le tampon des bornes de la scène, à la taille exacte du calcul qui va suivre. */
function sceneBoundsLot(
  source: THREE.Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  autonomous: boolean,
) {
  return autonomous ? exactPagesLot(source, associations, metadata) : hostBoundsLot(source);
}

export async function loadPreparedScene(
  options: ExplorerOptions,
  metadata: ClusterManifest,
  sceneFile: string,
  base: string,
  scope: string,
  autonomous: boolean,
  signal: AbortSignal | undefined,
  diagnose: ExplorerEmitters['diagnose'],
  registerSource: (source: THREE.Object3D) => void,
) {
  // Le chemin de calcul demandé par l'hôte vaut DÈS LE CHARGEMENT : le gouverneur le reçoit avant le
  // premier lot, et `configureExplorer` le lui redira sans rien changer. Le chargement du module part
  // ici et se recouvre avec celui de la scène, qui dure bien davantage.
  const calculEnLot = prepareMathBatch(options.mathPath ?? 'auto');
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => {
    if (!signal?.aborted) {
      const message = `Ressource chargée : ${decodeURIComponent(_url.split('/').at(-1) ?? _url)}`;
      options.onPreparation?.({ phase: 'resources', completed: loaded, total, message });
      diagnose('preparation', message, {
        kind: 'preparation',
        phase: 'resources',
        completed: loaded,
        total,
        resource: _url,
        scope,
      });
    }
  };
  // Les images dont la chaîne est cuite ne sont pas lues : le chargeur reçoit un pixel blanc à leur
  // place, et le moteur lira leurs niveaux dans le cache. Seulement sur demande de l'hôte, parce
  // qu'un moteur qui dessine la scène de l'hôte a besoin des vraies images.
  // GLTFLoader has no AbortSignal in this Three version; dispose late results after loading settles.
  const sceneUrl = new URL(sceneFile, base).href;
  const loader = new GLTFLoader(manager);
  let gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  if (options.textureSource === 'cache' && metadata.textures) {
    // Le glTF est lu une fois, ici : sa liste d'images dit lesquelles sauter, puis le chargeur
    // l'analyse tel quel, sans le redemander au réseau.
    const text = await (await checked(sceneUrl, signal)).text();
    const gltfJson = JSON.parse(text) as { images?: { uri?: string }[] };
    // L'adresse à sauter est celle que le chargeur demandera, par sa propre règle de résolution.
    const path = THREE.LoaderUtils.extractUrlBase(sceneUrl);
    const skipped = bakedImageUrls(metadata, gltfJson.images, (uri) =>
      THREE.LoaderUtils.resolveURL(uri, path),
    );
    diagnose('preparation', `Images lues dans le cache : ${skipped.size}`, {
      kind: 'preparation',
      phase: 'resources',
      bakedImages: skipped.size,
      scope,
    });
    manager.setURLModifier((url) => (skipped.has(url) ? PLACEHOLDER_IMAGE : url));
    gltf = await loader.parseAsync(text, path);
  } else gltf = await loader.loadAsync(sceneUrl);
  let source: THREE.Object3D = gltf.scene;
  registerSource(source);
  // Aucune pose non finie n'entre dans le moteur : la matrice monde de chaque maillage est calculée
  // une fois par le moteur, depuis les poses locales de l'hôte. Sans ce refus, un NaN de l'hôte
  // ressortirait en surface éteinte au fond du nuanceur d'éclairage, loin de sa cause.
  for (const mesh of objects(source))
    assertFiniteTransform(hostWorldChainInto(monde, mesh), mesh.name);
  const sceneLightingSource = options.sceneLighting ?? source;
  signal?.throwIfAborted();
  const associations = gltf.parser.associations as BackendContext['associations'];
  // Le sidecar nomme ses aperçus par rang de texture glTF ; c'est la seule table qui les relie aux
  // objets que le chargeur a construits.
  const textureIndices = new Map<THREE.Texture, number>();
  for (const [object, reference] of gltf.parser.associations as Map<object, { textures?: number }>)
    if (object instanceof THREE.Texture && typeof reference?.textures === 'number')
      textureIndices.set(object, reference.textures);
  await calculEnLot;
  const replicas = options.replicaCount ?? 1;
  // Les tampons du chargement, réservés avant d'être écrits et rendus sitôt lus : les bornes de la
  // scène — pages exactes d'une scène autonome, boîtes de l'hôte sinon, et seulement quand la
  // réplication les réclame — puis les matrices des répliques. Réserver par lot, jamais par image.
  const bornes =
    autonomous || replicas > 1
      ? await sceneBoundsLot(source, associations, metadata, autonomous)
      : null;
  // Le tampon des matrices monde que le moteur compose lui-même, à la taille du sous-arbre.
  const mondes = !autonomous && replicas > 1 ? await hostWorldLot(source) : null;
  const preparedBounds = autonomous
    ? exactPagesBounds(source, associations, metadata, manquante, undefined, bornes)
    : replicas > 1
      ? hostWorldBounds(source, undefined, bornes, mondes)
      : undefined;
  mondes?.release();
  const instances =
    replicas > 1 ? await createMultiplyLot(replicas * objects(source).length) : null;
  source = replicateInstances(source, associations, replicas, preparedBounds, instances);
  instances?.release();
  bornes?.release();
  // Le cadrage de la caméra reprend ces mêmes bornes sur la scène FINALE : son tampon est réservé
  // ici, à la taille qu'elle a une fois répliquée, et rendu par l'appelant.
  const framingLot = await sceneBoundsLot(source, associations, metadata, autonomous);
  return { source, sceneLightingSource, associations, textureIndices, framingLot };
}
