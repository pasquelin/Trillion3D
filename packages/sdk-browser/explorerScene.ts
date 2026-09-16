import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { meshes as objects } from './sceneMeshes.ts';
import { primitiveFinder } from './primitiveLookup.ts';
import { replicateInstances } from './replicateInstances.ts';
import { emptyWorldBox } from './hostWorldBounds.ts';
import {
  BOX_VALUES,
  EngineError,
  boxTransform,
  boxUnion,
  type ClusterManifest,
} from '../sdk-core/index.ts';
import type { BackendContext, ExplorerOptions } from './backendTypes.ts';
import type { ExplorerEmitters } from './explorerSession.ts';

/** Une boîte à plat de travail, reprise d'une page à l'autre : rien n'est alloué par page. */
const page = new Float64Array(BOX_VALUES);

/** World bounds of the exact pages of every mesh of `source`, à plat `[minX..maxZ]` ; `onMissing`
 *  decides what a mesh without a prepared primitive does, and the mesh is skipped once it returns.
 *  La transformation et l'union sont celles du socle, donc celles de la référence, terme à terme. */
export function exactPagesBounds(
  source: THREE.Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  onMissing: (mesh: THREE.Mesh) => void,
  into = emptyWorldBox(),
) {
  const primitiveOf = primitiveFinder(metadata.primitives);
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (!primitive) {
      onMissing(mesh);
      continue;
    }
    // La matrice monde du nœud hôte se LIT, une fois par maillage : le moteur ne la recompose pas.
    const world = mesh.matrixWorld.elements;
    for (const item of primitive.pages)
      if ((item.role ?? 'exact') === 'exact') {
        page[0] = item.min[0];
        page[1] = item.min[1];
        page[2] = item.min[2];
        page[3] = item.max[0];
        page[4] = item.max[1];
        page[5] = item.max[2];
        boxTransform(page, 0, page, 0, world);
        boxUnion(into, 0, page[0], page[1], page[2], page[3], page[4], page[5]);
      }
  }
  return into;
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
  const sceneLightingSource = options.sceneLighting ?? source;
  signal?.throwIfAborted();
  const associations = gltf.parser.associations as BackendContext['associations'];
  // Le sidecar nomme ses aperçus par rang de texture glTF ; c'est la seule table qui les relie aux
  // objets que le chargeur a construits.
  const textureIndices = new Map<THREE.Texture, number>();
  for (const [object, reference] of gltf.parser.associations as Map<object, { textures?: number }>)
    if (object instanceof THREE.Texture && typeof reference?.textures === 'number')
      textureIndices.set(object, reference.textures);
  const preparedBounds = autonomous
    ? exactPagesBounds(source, associations, metadata, () => {
        throw new EngineError(
          'AUTONOMOUS_ASSOCIATION_MISSING',
          'Prepared scene primitive has no geometry pages',
        );
      })
    : undefined;
  source = replicateInstances(source, associations, options.replicaCount ?? 1, preparedBounds);
  return { source, sceneLightingSource, associations, textureIndices };
}
