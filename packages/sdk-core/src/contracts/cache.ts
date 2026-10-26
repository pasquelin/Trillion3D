import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  DAG_ERROR_MODEL,
  FORMAT_VERSION,
  type AssetScope,
} from './base.ts'
import { primitiveUsesClusterErrors, type ClusterManifest } from './geometry.ts'
import { isRecord } from './nameMatch.ts'
import { TEXTURE_PREVIEW_VERSION } from './writtenFormats.ts'

/**
 * The error the engine throws: a stable `code` a page can test, words for a person, and details.
 * @errorCodes Every code it may carry is in `ENGINE_ERROR_CODES` (`errorCodes.ts`).
 */
export class EngineError extends Error {
  /** Which error it is, in capitals: the word a page tests. */
  readonly code: string
  /** Facts about the error: the file, the value, the limit. */
  readonly details: Record<string, unknown>
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.details = details
  }
}
/** Where a model's pages are read from, by key. */
export interface PageSource {
  /** Reads the bytes of one page; `priority`, when given, is the streamer's (smallest first). Each
   *  load of a page asks it: a source that takes `priority` joins a read of a page in flight,
   *  raised to the most urgent, rather than transfer the page twice. */
  read(key: string, signal?: AbortSignal, priority?: number): Promise<Uint8Array>
}
/** Refuses a cache format this runtime does not read. */
export function assertFormat(formatVersion: number) {
  if (formatVersion !== FORMAT_VERSION && formatVersion !== CLUSTERED_BLEND_FORMAT_VERSION)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `Expected cache format ${FORMAT_VERSION} or ${CLUSTERED_BLEND_FORMAT_VERSION}, received ${formatVersion}`,
      { formatVersion },
    )
}

/** The refusal of a cache whose clusters were certified with another error model than this one's. */
const staleErrorModel = (errorModel: unknown) =>
  new EngineError(
    'STALE_CACHE',
    `Cache error model ${errorModel ?? 'absent'} cannot be used; recompile with ${DAG_ERROR_MODEL}`,
    { errorModel: errorModel ?? null, expected: DAG_ERROR_MODEL },
  )

/**
 * What a host can check on a preparation pointer, before it knows anything about clusters: the
 * preparation is finished, it carries the scope that was asked for, and its format is one this SDK
 * reads. Returns the cache manifest URL the pointer names, to be resolved against the pointer URL.
 * A host has no business reading these fields itself; this is the check the reader runs.
 */
export function assertCachePointer(pointer: unknown, scope: AssetScope): string {
  if (!isRecord(pointer))
    throw new EngineError('INVALID_POINTER', 'preparation pointer is not a JSON object', {})
  const value = pointer as Record<string, unknown>
  if (typeof value.status !== 'string' || typeof value.url !== 'string' || !value.url)
    throw new EngineError('INVALID_POINTER', 'preparation pointer carries no valid status/url', {
      status: value.status ?? null,
      url: value.url ?? null,
    })
  if (value.status !== 'ready')
    throw new EngineError('CACHE_NOT_READY', 'The preparation pointer is not ready', {
      status: value.status,
    })
  if (value.scope !== undefined && value.scope !== scope)
    throw new EngineError('SCOPE_MISMATCH', `Requested ${scope}, pointer contains ${value.scope}`, {
      requestedScope: scope,
      pointerScope: value.scope,
    })
  if (value.formatVersion !== undefined) assertFormat(value.formatVersion as number)
  return value.url
}
/** What a host checks on the root `clusters.json` before any page: the cache is ready, of the
 *  requested scope, in a format this SDK reads. */
export function assertCacheRoot(root: unknown, scope: AssetScope): void {
  if (!isRecord(root))
    throw new EngineError('INVALID_CACHE', 'cache manifest is not a JSON object', {})
  const value = root as Record<string, unknown>
  // The number first: an earlier format is refused by it, never by a field it wrote otherwise.
  assertFormat(value.formatVersion as number)
  if (value.status !== 'ready')
    throw new EngineError('INVALID_CACHE', 'Unsupported Trillion3D cache', {
      status: value.status ?? null,
    })
  if (value.scope !== scope)
    throw new EngineError('SCOPE_MISMATCH', `Requested ${scope}, cache contains ${value.scope}`, {
      requestedScope: scope,
      cacheScope: value.scope,
    })
}
/** The manifest read through its pages: its root (`assertCacheRoot`) and selected geometry.
 *  Returns that triangle count; the clusters' identity is `assertCacheIdentity`'s. */
export function assertCacheReady(metadata: unknown, scope: AssetScope): number {
  assertCacheRoot(metadata, scope)
  const value = metadata as Record<string, unknown>
  if (
    !Array.isArray(value.primitives) ||
    !Number.isSafeInteger(value.selectedNodes) ||
    typeof value.selectedTriangles !== 'number' ||
    !Number.isFinite(value.selectedTriangles)
  )
    throw new EngineError('INVALID_CACHE', 'invalid cache schema', {})
  // The one identity statement a slim manifest can make on its own: a DAG cache names the model its
  // clusters were certified with. Older caches name neither and stay readable.
  if (value.clusterStrategy === 'dag-groups' && value.errorModel !== DAG_ERROR_MODEL)
    throw staleErrorModel(value.errorModel)
  return value.selectedTriangles
}
/**
 * Rejects any cache this runtime cannot draw. The runtime reads one geometry model, every
 * primitive's — blended and transmissive ones too —: a DAG of clusters where every cluster carries
 * its own screen-error band. A primitive without one, a cache whose clusters carry no band or one
 * from a compiler that left a whole mesh outside the DAG, is refused by name here rather than
 * half-read later.
 */
export function assertCacheIdentity(metadata: ClusterManifest) {
  // A manifest with a binary sidecar describes its clusters in columns; identity is a property of
  // the decoded pages, so decoding comes first and strips the pointer.
  if ((metadata as unknown as { binary?: unknown }).binary)
    throw new EngineError(
      'INVALID_CACHE',
      'A manifest with a binary sidecar must be decoded before its identity is checked',
      {},
    )
  const formatVersion = metadata.formatVersion
  assertFormat(formatVersion)
  if (
    formatVersion !== CLUSTERED_BLEND_FORMAT_VERSION &&
    metadata.primitives.some((primitive) => primitive.pass === 'clustered-blend')
  )
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `clustered-blend requires cache format ${CLUSTERED_BLEND_FORMAT_VERSION}`,
      { formatVersion },
    )
  const missing = metadata.primitives.findIndex(
    (primitive) => !primitiveUsesClusterErrors(primitive),
  )
  if (missing >= 0) {
    const primitive = metadata.primitives[missing]
    throw new EngineError(
      'STALE_CACHE',
      `Cache without a cluster DAG cannot be used: primitive ${primitive.mesh}/${primitive.primitive} has no per-cluster error band; recompile with ${DAG_ERROR_MODEL}`,
      {
        mesh: primitive.mesh,
        primitive: primitive.primitive,
        pass: primitive.pass,
        errorModel: metadata.errorModel ?? null,
        expected: DAG_ERROR_MODEL,
      },
    )
  }
  if (metadata.errorModel !== DAG_ERROR_MODEL) throw staleErrorModel(metadata.errorModel)
  // Texture levels of another version — before 6, block files not laid out in tile records —
  // would be cut at the wrong bytes: the cache is refused whole, never drawn coarse.
  const { textures } = metadata
  if (textures && textures.version !== TEXTURE_PREVIEW_VERSION)
    throw new EngineError(
      'STALE_CACHE',
      `Cache texture levels are version ${textures.version ?? 'absent'}, this runtime reads ${TEXTURE_PREVIEW_VERSION}; recompile the cache (trillion3d-compile, or pnpm run compile:caches in the repository)`,
      { textureVersion: textures.version ?? null, expected: TEXTURE_PREVIEW_VERSION },
    )
}
