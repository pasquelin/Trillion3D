import { meshes as objects } from '../../scene/meshes.ts';
import { assertFiniteTransform } from '../../host/world/matrices.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import { pagesBounds, sceneBoundsLot } from './pagesBounds.ts';
import { replicateInstances } from '../../scene/replicateInstances.ts';
import { hostWorldBounds } from '../../host/world/bounds.ts';
import { hostWorldLot } from '../../host/world/tree.ts';
import {
  EngineError,
  MATRIX_VALUES,
  type ClusterManifest,
} from '../../../../sdk-core/src/index.ts';
import type { ManifestPages } from '../../../../sdk-core/src/manifest/paged.ts';
import { createMultiplyLot } from '../../math/batchRuntime.ts';
import { prepareMathBatch } from '../../math/batchState.ts';
import type { MeasuredWorldOptions } from '../../backend/types.ts';
import type { ExplorerEmitters } from '../session/session.ts';
import { resourceProgress } from './resourceProgress.ts';
import { openWorldRoots } from '../../scene/worldRoots.ts';
import { loadPreparedSceneTables } from '../../scene/tables.ts';
import { buildPreparedScene } from '../../host/prepared/build.ts';
import { createPartitionCells } from '../../scene/partition/cells.ts';
import type { ByteMeter } from '../../cluster/byteMeter.ts';
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** World matrix of a mesh at load, reused from mesh to mesh. */
const monde = new Float64Array(MATRIX_VALUES);

/** A mesh of the prepared scene with no geometry pages, and no rows whose box bounds it before
 *  its pages are read (#751): the autonomous scene is incomplete. */
function manquante(): never {
  throw new EngineError(
    'AUTONOMOUS_ASSOCIATION_MISSING',
    'Prepared scene primitive has no geometry pages',
  );
}

/** What a load that counts bytes adds: the meter of each read, who hears the tables read, and the
 *  mesh pages of a manifest the view holds (#751). */
type Metered = {
  meter?: ByteMeter;
  onTables?: (tables: PreparedSceneTables) => void;
  pages?: ManifestPages;
};

/** Builds the scene a cache prepared: its tables, then the files they name. `options.meter` counts
 *  the bytes of each as they arrive, `onTables` hears the tables before those files are read;
 *  `onPreparation` hears the tables read, then each resource. With `pages`, the mesh pages the
 *  node table needs are held for good, and each cell holds its own while placed (#751). */
export async function loadPreparedScene(
  options: MeasuredWorldOptions & Metered,
  metadata: ClusterManifest,
  sceneFile: string,
  base: string,
  scope: string,
  autonomous: boolean,
  signal: AbortSignal | undefined,
  diagnose: ExplorerEmitters['diagnose'],
  registerSource: (source: Object3D) => void,
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
  const { tables, bytes } = await loadPreparedSceneTables(base, signal, options.meter);
  const buildAt = performance.now();
  signal?.throwIfAborted();
  options.onTables?.(tables);
  options.onPreparation?.({
    phase: 'tables',
    completed: 1,
    total: 1,
    message: 'Read the scene tables',
  });
  const skipBaked = options.textureSource !== 'host';
  // The manifest pages the node table needs are read while the scene builds, which reads none.
  const [built, worldRoots] = await Promise.all([
    buildPreparedScene({
      tables,
      metadata,
      sceneFile,
      base,
      skipBaked,
      signal,
      track: resourceProgress(options, diagnose, scope, signal),
      meter: options.meter,
    }),
    openWorldRoots(metadata, base, signal, options.meter),
    options.pages?.hold(tables.meshPages),
  ]);
  // The world top is pinned; a scene not partitioned is one cell, placed for its whole life.
  if (!tables.partition) await worldRoots?.hold(0);
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
          pages: options.pages,
          world: worldRoots,
        }),
      ]
    : [];
  diagnose('prepared-scene', 'Scene built from the cache tables', {
    kind: 'preparation',
    scope,
    nodes: tables.nodes.length,
    placements: [...(tables.partition?.totals.values() ?? [])].reduce((sum, n) => sum + n, 0),
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
  return {
    ...{ source, sceneLightingSource, associations, textureIndices, framingLot, partitions },
    // The world roots each model holds, which the session counts in its CPU budget (#1237).
    worldRoots: worldRoots ? [worldRoots] : [],
    // Each glTF node's host node, by its index: a partition renumbers the table, replicas copy it.
    nodes: tables.partition || replicas > 1 ? null : built.nodes,
  };
}
