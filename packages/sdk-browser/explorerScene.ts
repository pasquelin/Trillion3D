import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { meshes as objects } from './sceneMeshes.ts';
import { replicateInstances } from './replicateInstances.ts';
import { EngineError, type ClusterManifest } from '../sdk-core/index.ts';
import type { BackendContext, ExplorerOptions } from './backendTypes.ts';
import type { ExplorerEmitters } from './explorerSession.ts';

/** World bounds of the exact pages of every mesh of `source`; `onMissing` decides what a mesh
 *  without a prepared primitive does, and the mesh is skipped once it returns. */
export function exactPagesBounds(
  source: THREE.Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  onMissing: (mesh: THREE.Mesh) => void,
  into = new THREE.Box3(),
) {
  for (const mesh of objects(source)) {
    const association = associations.get(mesh);
    const primitive = metadata.primitives.find(
      (item) =>
        item.mesh === association?.meshes && item.primitive === (association?.primitives ?? 0),
    );
    if (!primitive) {
      onMissing(mesh);
      continue;
    }
    for (const page of primitive.pages)
      if ((page.role ?? 'exact') === 'exact')
        into.union(
          new THREE.Box3(
            new THREE.Vector3().fromArray(page.min),
            new THREE.Vector3().fromArray(page.max),
          ).applyMatrix4(mesh.matrixWorld),
        );
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
