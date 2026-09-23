import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  DAG_ERROR_MODEL,
  FORMAT_VERSION,
  type AssetScope,
} from './base.ts';
import { UNSPLIT_PASS, primitiveIsDrawable, type ClusterManifest } from './geometry.ts';

/**
 * The error the engine throws: a stable `code` a page can test, words for a person, and details.
 * @errorCode CANVAS_NOT_FOUND, CANVAS_DOCUMENT_UNAVAILABLE, CANVAS_WINDOW_UNAVAILABLE, INVALID_CANVAS - The world has no canvas to draw into: none found, or no page around it.
 * @errorCode INVALID_CANVAS_LAYOUT, INVALID_VIEWPORT, INVALID_PIXEL_RATIO - The canvas has no usable size or pixel ratio.
 * @errorCode WEBGPU_UNAVAILABLE, WEBGL2_UNAVAILABLE, NO_WEBGL2, NO_ENGINE_BACKEND - The machine cannot draw the way asked, or cannot draw at all.
 * @errorCode RESOURCE_HTTP_ERROR, INVALID_JSON_RESPONSE - A file could not be fetched, or was not what it should be.
 * @errorCode INVALID_POINTER, CACHE_NOT_READY, SCOPE_MISMATCH - The compiled model's pointer is broken, unfinished, or of another scope.
 * @errorCode INVALID_CACHE, UNSUPPORTED_FORMAT, STALE_CACHE, UNSUPPORTED_MODEL_FORMAT - The compiled model is damaged, too old, too new or of a format not read yet: compile it again.
 * @errorCode INVALID_SCENE_TABLES, UNSUPPORTED_SCENE_TABLES, PREPARED_SCENE_MISMATCH - The model's node and material tables are missing, of another version, or disagree with its scene.
 * @errorCode AUTONOMOUS_SCENE_UNAVAILABLE, AUTONOMOUS_ASSOCIATION_MISSING, AUTONOMOUS_COVERAGE_MISSING, CLUSTER_MATERIAL_UNSUPPORTED - The engine's own WebGL2 path cannot draw this model.
 * @errorCode PAGE_BUDGET, UNSUPPORTED_MEMORY_BUDGETS - The pages the view needs do not fit the memory budget, or this path has no budgets.
 * @errorCode INVALID_SCENE_LIGHT, DUPLICATE_SCENE_LIGHT, UNKNOWN_SCENE_LIGHT, SCENE_LIGHT_BUDGET, SCENE_LIGHTS_UNAVAILABLE - A light is malformed, doubled, unknown, one too many, or has nowhere to go.
 * @errorCode INVALID_SCENE_ENVIRONMENT - The scene's exposure or surroundings are not valid numbers.
 * @errorCode INVALID_TRANSFORM, NON_FINITE_TRANSFORM, SINGULAR_PARENT_TRANSFORM, TRANSFORM_CYCLE - A node's placement is not a usable matrix, or a node would be its own ancestor.
 * @errorCode UNKNOWN_SCENE_NODE, UNKNOWN_TRANSFORM_NODE, STALE_SCENE_NODE, INVALID_SCENE_NODE_ID, DUPLICATE_SCENE_NODE_ID, INVALID_SCENE_NODE_VISIBILITY - A scene node is unknown, gone, badly named, or given a visibility that is not yes or no.
 * @errorCode SCENE_ROOT_PARENT, SCENE_ROOT_DESTROY, SCENE_ROOT_MISMATCH, SCENE_COPY_OVERLAP - Something the scene root forbids: a parent for it, destroying it, mixing two roots, copying a node into itself.
 * @errorCode UNSUPPORTED_SCENE_UPDATE, BATCHED_WORLD_VIEW - This drawing path cannot make that change to the scene.
 * @errorCode RAYCAST_NO_VIEW - A picture point was asked of a canvas with no size: there is no picture to aim through.
 * @errorCode SESSION_OPEN_FAILED, WEBGPU_LOST - The world's session could not open (`world.diagnostic.error`): WebGPU lost its device, or the reason is in `details.cause`.
 * @errorCode UNSUPPORTED_SCENE_FORMAT, SCENE_NOT_SAVABLE - A saved scene is of another format or version, or holds what a saved scene cannot store.
 */
export class EngineError extends Error {
  /** Which error it is, in capitals: the word a page tests. */
  readonly code: string;
  /** Facts about the error: the file, the value, the limit. */
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
  }
}
/** Where a model's pages are read from, by key. */
export interface PageSource {
  /** Reads the bytes of one page. */
  read(key: string, signal?: AbortSignal): Promise<Uint8Array>;
}
/** Refuses a cache format this runtime does not read. */
export function assertFormat(formatVersion: number) {
  if (formatVersion !== FORMAT_VERSION && formatVersion !== CLUSTERED_BLEND_FORMAT_VERSION)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `Expected cache format ${FORMAT_VERSION} or ${CLUSTERED_BLEND_FORMAT_VERSION}, received ${formatVersion}`,
      { formatVersion },
    );
}

/**
 * What a host can check on a preparation pointer, before it knows anything about clusters: the
 * preparation is finished, it carries the scope that was asked for, and its format is one this SDK
 * reads. Returns the cache manifest URL the pointer names, to be resolved against the pointer URL.
 * A host has no business reading these fields itself; this is the check the reader runs.
 */
export function assertCachePointer(pointer: unknown, scope: AssetScope): string {
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer))
    throw new EngineError('INVALID_POINTER', 'preparation pointer is not a JSON object', {});
  const value = pointer as Record<string, unknown>;
  if (typeof value.status !== 'string' || typeof value.url !== 'string' || !value.url)
    throw new EngineError('INVALID_POINTER', 'preparation pointer carries no valid status/url', {
      status: value.status ?? null,
      url: value.url ?? null,
    });
  if (value.status !== 'ready')
    throw new EngineError('CACHE_NOT_READY', 'The preparation pointer is not ready', {
      status: value.status,
    });
  if (value.scope !== undefined && value.scope !== scope)
    throw new EngineError('SCOPE_MISMATCH', `Requested ${scope}, pointer contains ${value.scope}`, {
      requestedScope: scope,
      pointerScope: value.scope,
    });
  if (value.formatVersion !== undefined) assertFormat(value.formatVersion as number);
  return value.url;
}
/**
 * What a host can check on the cache manifest alone, whether its clusters are written inline or in a
 * binary sidecar: the cache is ready, of the requested scope, in a format this SDK reads, and
 * declares the geometry it selected. Returns that triangle count, so an availability probe needs to
 * read nothing else and needs to know no field name.
 *
 * The identity of the clusters themselves is `assertCacheIdentity`: it reads the pages, so it runs
 * on a decoded manifest, which a probe deliberately does not download.
 */
export function assertCacheReady(metadata: unknown, scope: AssetScope): number {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new EngineError('INVALID_CACHE', 'cache manifest is not a JSON object', {});
  const value = metadata as Record<string, unknown>;
  if (
    !Array.isArray(value.primitives) ||
    !Array.isArray(value.selectedNodes) ||
    typeof value.selectedTriangles !== 'number' ||
    !Number.isFinite(value.selectedTriangles)
  )
    throw new EngineError('INVALID_CACHE', 'invalid cache schema', {});
  const formatVersion = (value.formatVersion ?? value.schema) as number;
  assertFormat(formatVersion);
  if (value.schema !== formatVersion)
    throw new EngineError('UNSUPPORTED_FORMAT', 'Cache schema and formatVersion differ', {
      schema: value.schema,
      formatVersion,
    });
  if (value.status !== 'ready')
    throw new EngineError('INVALID_CACHE', 'Unsupported Trillion3D cache', {
      status: value.status ?? null,
    });
  if (value.scope !== scope)
    throw new EngineError('SCOPE_MISMATCH', `Requested ${scope}, cache contains ${value.scope}`, {
      requestedScope: scope,
      cacheScope: value.scope,
    });
  // The one identity statement a slim manifest can make on its own: a DAG cache names the model its
  // clusters were certified with. Older caches name neither and stay readable.
  if (value.clusterStrategy === 'dag-groups' && value.errorModel !== DAG_ERROR_MODEL)
    throw new EngineError(
      'STALE_CACHE',
      `Cache error model ${value.errorModel ?? 'absent'} cannot be used; recompile with ${DAG_ERROR_MODEL}`,
      { errorModel: value.errorModel ?? null, expected: DAG_ERROR_MODEL },
    );
  return value.selectedTriangles;
}
/**
 * Rejects any cache this runtime cannot draw. The runtime reads one geometry model: a DAG of
 * clusters where every cluster carries its own screen-error band, or a whole mesh the compiler kept
 * outside the DAG (`shared-blend`), which carries no cluster at all. A cache whose clusters carry no
 * band — the old page tree — is refused by name here rather than half-read later.
 */
export function assertCacheIdentity(metadata: ClusterManifest) {
  // A manifest with a binary sidecar describes its clusters in columns; identity is a property of
  // the decoded pages, so decoding comes first and strips the pointer.
  if ((metadata as unknown as { binary?: unknown }).binary)
    throw new EngineError(
      'INVALID_CACHE',
      'A manifest with a binary sidecar must be decoded before its identity is checked',
      {},
    );
  const formatVersion = metadata.formatVersion ?? metadata.schema;
  assertFormat(formatVersion);
  if (metadata.schema !== formatVersion)
    throw new EngineError('UNSUPPORTED_FORMAT', 'Cache schema and formatVersion differ', {
      schema: metadata.schema,
      formatVersion,
    });
  if (
    formatVersion !== CLUSTERED_BLEND_FORMAT_VERSION &&
    metadata.primitives.some((primitive) => primitive.pass === 'clustered-blend')
  )
    throw new EngineError('UNSUPPORTED_FORMAT', 'clustered-blend requires cache format 2', {
      formatVersion,
    });
  const missing = metadata.primitives.findIndex((primitive) => !primitiveIsDrawable(primitive));
  if (missing >= 0) {
    const primitive = metadata.primitives[missing];
    const cause =
      primitive.pass === UNSPLIT_PASS
        ? `is ${UNSPLIT_PASS} yet carries ${primitive.pages.length} cluster pages`
        : 'has no per-cluster error band';
    throw new EngineError(
      'STALE_CACHE',
      `Cache without a cluster DAG cannot be used: primitive ${primitive.mesh}/${primitive.primitive} ${cause}; recompile with ${DAG_ERROR_MODEL}`,
      {
        mesh: primitive.mesh,
        primitive: primitive.primitive,
        pass: primitive.pass,
        errorModel: metadata.errorModel ?? null,
        expected: DAG_ERROR_MODEL,
      },
    );
  }
  if (metadata.errorModel !== DAG_ERROR_MODEL)
    throw new EngineError(
      'STALE_CACHE',
      `Cache error model ${metadata.errorModel ?? 'absent'} cannot be used; recompile with ${DAG_ERROR_MODEL}`,
      { errorModel: metadata.errorModel ?? null, expected: DAG_ERROR_MODEL },
    );
}
