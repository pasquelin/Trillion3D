import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { meshes as objects } from './sceneMeshes.ts';
import { replicateInstances } from './replicateInstances.ts';
import { EngineError, type ClusterManifest } from '../sdk-core/index.ts';
import type { BackendContext, ExplorerOptions } from './backendTypes.ts';

type Diagnose = (phase: string, message: string, context?: Record<string, unknown>) => void;

export async function loadPreparedScene(
  options: ExplorerOptions,
  metadata: ClusterManifest,
  sceneFile: string,
  base: string,
  scope: string,
  autonomous: boolean,
  signal: AbortSignal | undefined,
  diagnose: Diagnose,
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
  let preparedBounds: THREE.Box3 | undefined;
  if (autonomous) {
    preparedBounds = new THREE.Box3();
    for (const mesh of objects(source)) {
      const association = (gltf.parser.associations as BackendContext['associations']).get(mesh);
      const primitive = metadata.primitives.find(
        (item) =>
          item.mesh === association?.meshes && item.primitive === (association?.primitives ?? 0),
      );
      if (!primitive)
        throw new EngineError(
          'AUTONOMOUS_ASSOCIATION_MISSING',
          'Prepared scene primitive has no geometry pages',
        );
      for (const page of primitive.pages)
        if ((page.role ?? 'exact') === 'exact')
          preparedBounds.union(
            new THREE.Box3(
              new THREE.Vector3().fromArray(page.min),
              new THREE.Vector3().fromArray(page.max),
            ).applyMatrix4(mesh.matrixWorld),
          );
    }
  }
  source = replicateInstances(
    source,
    gltf.parser.associations as BackendContext['associations'],
    options.replicaCount ?? 1,
    preparedBounds,
  );
  return {
    source,
    sceneLightingSource,
    associations: gltf.parser.associations as BackendContext['associations'],
  };
}
