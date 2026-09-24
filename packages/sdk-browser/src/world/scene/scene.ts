import { meshes as objects } from '../../scene/meshes.ts';
import type { HostGraphNode } from '../../host/scene/graphNodes.ts';
import { assertFiniteTransform } from '../../host/world/matrices.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import { pagesBounds, pagesLot } from './pagesBounds.ts';
import { replicateInstances } from '../../scene/replicateInstances.ts';
import { hostBoundsLot, hostWorldBounds } from '../../host/world/bounds.ts';
import { hostWorldLot } from '../../host/world/tree.ts';
import {
  EngineError,
  MATRIX_VALUES,
  type ClusterManifest,
} from '../../../../sdk-core/src/index.ts';
import { createMultiplyLot } from '../../math/batchRuntime.ts';
import { prepareMathBatch } from '../../math/batchState.ts';
import type { BackendContext, MeasuredWorldOptions } from '../../backend/types.ts';
import type { ExplorerEmitters } from '../session/session.ts';
import { loadPreparedSceneTables } from '../../scene/tables.ts';
import { buildPreparedScene } from '../../host/prepared/build.ts';
import { createPartitionCells } from '../../scene/partition/cells.ts';

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
  source: HostGraphNode,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  autonomous: boolean,
) {
  return autonomous ? pagesLot(source, associations, metadata) : hostBoundsLot(source);
}

/** Counts the resources a preparation reads, and tells the host of each as it lands. */
function resourceProgress(
  options: MeasuredWorldOptions,
  diagnose: ExplorerEmitters['diagnose'],
  scope: string,
  signal: AbortSignal | undefined,
) {
  let total = 0,
    completed = 0;
  return <T>(resource: string, read: Promise<T>) => {
    total++;
    return read.finally(() => {
      completed++;
      if (signal?.aborted) return;
      const message = `Loaded resource: ${decodeURIComponent(resource.split('/').at(-1) ?? resource)}`;
      options.onPreparation?.({ phase: 'resources', completed, total, message });
      diagnose('preparation', message, {
        kind: 'preparation',
        phase: 'resources',
        completed,
        total,
        resource,
        scope,
      });
    });
  };
}

export async function loadPreparedScene(
  options: MeasuredWorldOptions,
  metadata: ClusterManifest,
  sceneFile: string,
  base: string,
  scope: string,
  autonomous: boolean,
  signal: AbortSignal | undefined,
  diagnose: ExplorerEmitters['diagnose'],
  registerSource: (source: HostGraphNode) => void,
) {
  // The compute path the host asked for holds FROM LOAD: the governor receives it before the
  // first lot, and `configureExplorer` will tell it again without changing anything. Module
  // load starts here and overlaps with the scene's, which lasts much longer.
  const calculEnLot = prepareMathBatch(options.mathPath ?? 'auto');
  // The scene is built from the cache alone: its tables, the binary of the document it draws and
  // the images they locate. Images whose chain is baked are not read: a white pixel stands in
  // their place, and the engine reads their levels from the cache — which it does either way.
  // `textureSource` arrives resolved against the paths that will draw (`resolveTextureSource`):
  // it reads `'host'` wherever one of them samples the images themselves.
  const readAt = performance.now();
  const { tables, bytes } = await loadPreparedSceneTables(base, signal);
  const buildAt = performance.now();
  const skipBaked = options.textureSource !== 'host';
  const built = await buildPreparedScene({
    tables,
    metadata,
    sceneFile,
    base,
    skipBaked,
    signal,
    track: resourceProgress(options, diagnose, scope, signal),
  });
  if (skipBaked && metadata.textures)
    diagnose('preparation', `Images read from the cache: ${built.bakedImages}`, {
      kind: 'preparation',
      phase: 'resources',
      bakedImages: built.bakedImages,
      scope,
    });
  const { associations, textureIndices } = built;
  let source = built.source;
  const replicas = options.replicaCount ?? 1;
  // The cells a partition reads by distance place rows the replicas would share.
  if (tables.partition && replicas > 1)
    throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'a partitioned scene is not replicated', {
      replicas,
    });
  const partitions = tables.partition
    ? [
        createPartitionCells({
          partition: tables.partition,
          base,
          root: source,
          parents: built.nodes,
          meshes: built.placed,
        }),
      ]
    : [];
  diagnose('prepared-scene', 'Scene built from the cache tables', {
    kind: 'preparation',
    scope,
    nodes: tables.nodes.length,
    cells: tables.partition?.cells.length ?? 0,
    materials: tables.materials.length,
    textures: textureIndices.size,
    bytes,
    readMs: buildAt - readAt,
    buildMs: performance.now() - buildAt,
  });
  registerSource(source);
  // No non-finite pose enters the engine: each mesh world matrix is computed once by the
  // engine, from the host's local poses. Without this refusal, a host NaN would come out as
  // a darkened surface at the bottom of the lighting shader, far from its cause.
  for (const mesh of objects(source))
    assertFiniteTransform(hostWorldChainInto(monde, mesh), mesh.name);
  const sceneLightingSource = options.sceneLighting ?? source;
  signal?.throwIfAborted();
  await calculEnLot;
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
    ? pagesBounds(source, associations, metadata, manquante, undefined, bornes)
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
  return { source, sceneLightingSource, associations, textureIndices, framingLot, partitions };
}
