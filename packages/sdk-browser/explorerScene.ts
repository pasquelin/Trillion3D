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
import { checkPreparedScene, loadPreparedSceneTables } from './preparedSceneTables.ts';

/** World matrix of a mesh at load, reused from mesh to mesh. */
const monde = new Float64Array(MATRIX_VALUES);

/** A mesh of the prepared scene with no geometry pages: the autonomous scene is incomplete. */
function manquante(): never {
  throw new EngineError(
    'AUTONOMOUS_ASSOCIATION_MISSING',
    'Prepared scene primitive has no geometry pages',
  );
}

/** Scene-bounds buffer, at the exact size of the compute that follows. */
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
  // The compute path the host asked for holds FROM LOAD: the governor receives it before the
  // first lot, and `configureExplorer` will tell it again without changing anything. Module
  // load starts here and overlaps with the scene's, which lasts much longer.
  const calculEnLot = prepareMathBatch(options.mathPath ?? 'auto');
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => {
    if (!signal?.aborted) {
      const message = `Loaded resource: ${decodeURIComponent(_url.split('/').at(-1) ?? _url)}`;
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
  // Images whose chain is baked are not read: the loader receives a white pixel in their
  // place, and the engine reads their levels from the cache — which it does either way, so
  // fetching them here would buy nothing. A host that says `'host'` wants them anyway, because
  // an engine that draws the host scene samples the images themselves.
  // GLTFLoader has no AbortSignal in this Three version; dispose late results after loading settles.
  const sceneUrl = new URL(sceneFile, base).href;
  const loader = new GLTFLoader(manager);
  let gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  if (options.textureSource !== 'host' && metadata.textures) {
    // The glTF is read once, here: its image list says which to skip, then the loader parses
    // it as-is, without asking the network again.
    const text = await (await checked(sceneUrl, signal)).text();
    const gltfJson = JSON.parse(text) as { images?: { uri?: string }[] };
    // The address to skip is the one the loader will ask for, by its own resolution rule.
    const path = THREE.LoaderUtils.extractUrlBase(sceneUrl);
    const skipped = bakedImageUrls(metadata, gltfJson.images, (uri) =>
      THREE.LoaderUtils.resolveURL(uri, path),
    );
    diagnose('preparation', `Images read from the cache: ${skipped.size}`, {
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
  // No non-finite pose enters the engine: each mesh world matrix is computed once by the
  // engine, from the host's local poses. Without this refusal, a host NaN would come out as
  // a darkened surface at the bottom of the lighting shader, far from its cause.
  for (const mesh of objects(source))
    assertFiniteTransform(hostWorldChainInto(monde, mesh), mesh.name);
  const sceneLightingSource = options.sceneLighting ?? source;
  signal?.throwIfAborted();
  const associations = gltf.parser.associations as BackendContext['associations'];
  // The sidecar names its previews by glTF texture rank; that is the only table that ties
  // them to the objects the loader built.
  const textureIndices = new Map<THREE.Texture, number>();
  for (const [object, reference] of gltf.parser.associations as Map<object, { textures?: number }>)
    if (object instanceof THREE.Texture && typeof reference?.textures === 'number')
      textureIndices.set(object, reference.textures);
  // What the cache says this scene is, checked against the scene just built — before any
  // replication, which is the host's own copy of it. This batch draws nothing from the tables:
  // it proves them, and a divergence refuses the session by name rather than passing silently.
  const readAt = performance.now();
  const { tables, bytes } = await loadPreparedSceneTables(base, signal);
  const checkAt = performance.now();
  const agreement = checkPreparedScene({ tables, source, associations, textureIndices });
  diagnose('prepared-scene', 'Cache tables checked against the loaded scene', {
    kind: 'preparation',
    scope,
    ...agreement,
    bytes,
    readMs: checkAt - readAt,
    checkMs: performance.now() - checkAt,
  });
  await calculEnLot;
  const replicas = options.replicaCount ?? 1;
  // Load buffers, reserved before they are written and returned as soon as they are read:
  // scene bounds — exact pages of an autonomous scene, host boxes otherwise, and only when
  // replication asks for them — then replica matrices. Reserve by lot, never per frame.
  const bornes =
    autonomous || replicas > 1
      ? await sceneBoundsLot(source, associations, metadata, autonomous)
      : null;
  // Buffer of the world matrices the engine composes itself, at the subtree size.
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
  // Camera framing takes these same bounds on the FINAL scene: its buffer is reserved here,
  // at the size it has once replicated, and returned by the caller.
  const framingLot = await sceneBoundsLot(source, associations, metadata, autonomous);
  return { source, sceneLightingSource, associations, textureIndices, framingLot };
}
