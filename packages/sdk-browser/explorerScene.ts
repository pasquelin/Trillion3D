import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { meshes as objects } from './sceneMeshes.ts';
import { assertFiniteTransform } from './hostWorldMatrices.ts';
import { primitiveFinder } from './primitiveLookup.ts';
import { replicateInstances } from './replicateInstances.ts';
import { emptyWorldBox, hostBoundsLot, hostWorldBounds } from './hostWorldBounds.ts';
import {
  BOX_VALUES,
  EngineError,
  MATRIX_VALUES,
  boxTransform,
  boxUnion,
  type ClusterManifest,
} from '../sdk-core/index.ts';
import {
  createBoxTransformLot,
  createMultiplyLot,
  type BoxTransformLot,
} from './mathBatchRuntime.ts';
import { lotBoxesReady, unionLotBoxes } from './mathBatchBoxes.ts';
import { prepareMathBatch } from './mathBatchState.ts';
import type { BackendContext, ExplorerOptions } from './backendTypes.ts';
import type { ExplorerEmitters } from './explorerSession.ts';

/** Une boîte à plat de travail, reprise d'une page à l'autre : rien n'est alloué par page. */
const page = new Float64Array(BOX_VALUES);

/** Une page du manifeste porte des bornes exactes, ou n'est qu'une approximation grossière. */
type ManifestPage = ClusterManifest['primitives'][number]['pages'][number];
const exacte = (item: ManifestPage) => (item.role ?? 'exact') === 'exact';

/** Les bornes du manifeste écrites à plat, six flottants à partir de `at`. */
function ecritPage(out: Float64Array, at: number, item: ManifestPage) {
  out[at] = item.min[0];
  out[at + 1] = item.min[1];
  out[at + 2] = item.min[2];
  out[at + 3] = item.max[0];
  out[at + 4] = item.max[1];
  out[at + 5] = item.max[2];
}

/** Pages exactes de `source` : la taille EXACTE que le lot de boîtes doit porter. */
function exactPagesCount(
  source: THREE.Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
) {
  const primitiveOf = primitiveFinder(metadata.primitives);
  let n = 0;
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (primitive) for (const item of primitive.pages) if (exacte(item)) n++;
  }
  return n;
}

/** Le lot qui porte ces pages, ou `null` quand il n'y en a aucune : une réservation, pas une image. */
async function exactPagesLot(
  source: THREE.Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
) {
  const n = exactPagesCount(source, associations, metadata);
  return n ? await createBoxTransformLot(n) : null;
}

/** World bounds of the exact pages of every mesh of `source`, à plat `[minX..maxZ]` ; `onMissing`
 *  decides what a mesh without a prepared primitive does, and the mesh is skipped once it returns.
 *  La transformation et l'union sont celles du socle, donc celles de la référence, terme à terme. */
export function exactPagesBounds(
  source: THREE.Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  onMissing: (mesh: THREE.Mesh) => void,
  into = emptyWorldBox(),
  lot?: BoxTransformLot | null,
) {
  const primitiveOf = primitiveFinder(metadata.primitives);
  const enLot = lotBoxesReady(lot, exactPagesCount(source, associations, metadata));
  let n = 0;
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (!primitive) {
      onMissing(mesh);
      continue;
    }
    // La matrice monde du nœud hôte se LIT, une fois par maillage : le moteur ne la recompose pas.
    const world = mesh.matrixWorld.elements;
    for (const item of primitive.pages)
      if (exacte(item)) {
        if (enLot) {
          ecritPage(enLot.boxes, n * BOX_VALUES, item);
          enLot.mats.set(world, n++ * MATRIX_VALUES);
          continue;
        }
        ecritPage(page, 0, item);
        boxTransform(page, 0, page, 0, world);
        boxUnion(into, 0, page[0], page[1], page[2], page[3], page[4], page[5]);
      }
  }
  if (!enLot) return into;
  enLot.run();
  unionLotBoxes(into, enLot, n);
  return into;
}

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
  // GLTFLoader has no AbortSignal in this Three version; dispose late results after loading settles.
  const gltf = await new GLTFLoader(manager).loadAsync(new URL(sceneFile, base).href);
  let source: THREE.Object3D = gltf.scene;
  registerSource(source);
  // Aucune pose non finie n'entre dans le moteur : `meshes` résout le sous-arbre, et chaque matrice
  // monde est lue une fois. Sans ce refus, un NaN de l'hôte ressortirait en surface éteinte au fond
  // du nuanceur d'éclairage, loin de sa cause.
  for (const mesh of objects(source)) assertFiniteTransform(mesh.matrixWorld.elements, mesh.name);
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
  const preparedBounds = autonomous
    ? exactPagesBounds(source, associations, metadata, manquante, undefined, bornes)
    : replicas > 1
      ? hostWorldBounds(source, undefined, bornes)
      : undefined;
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
