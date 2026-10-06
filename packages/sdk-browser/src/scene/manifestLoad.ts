import {
  assertCacheIdentity,
  assertCachePointer,
  assertCacheReady,
  assertCacheRoot,
  EngineError,
  DEFAULT_SCOPE,
  readPagedManifest,
  type AssetScope,
  type ClusterManifest,
  type Primitive,
} from '../../../sdk-core/src/index.ts'
import { openPagedManifest, type ManifestPages } from '../../../sdk-core/src/manifest/paged.ts'
import { absolutePrimitive } from './absolutePrimitive.ts'
import { fetchVerified } from '../cluster/pages.ts'
import { checked } from '../cluster/checked.ts'
import { unmetered, type ByteMeter } from '../cluster/byteMeter.ts'

async function jsonResource(
  url: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
): Promise<{
  value: Record<string, unknown>
  details: { url: string; status: number; contentType: string }
  bytes: number
}> {
  const response = meter.read(await checked(url, signal), url),
    contentType = response.headers.get('content-type') ?? ''
  const details = { url, status: response.status, contentType }
  if (!/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(contentType))
    throw new EngineError(
      'INVALID_JSON_RESPONSE',
      `${url}: expected JSON, HTTP ${response.status}, type ${contentType || 'absent'}`,
      details,
    )
  // `response.json()` parses the bytes without ever materialising the text; the declared length is
  // enough for the diagnostic, and reading the body twice to count would cost more than it reports.
  const declared = Number(response.headers.get('content-length'))
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new EngineError(
      'INVALID_JSON_RESPONSE',
      `${url}: invalid JSON, HTTP ${response.status}, type ${contentType}`,
      details,
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EngineError(
      'INVALID_JSON_RESPONSE',
      `${url}: expected JSON object, HTTP ${response.status}, type ${contentType}`,
      details,
    )
  return {
    value: value as Record<string, unknown>,
    details,
    bytes: Number.isFinite(declared) ? declared : 0,
  }
}

/** The public checks know the format, not the response that carried it: this names the resource in
 *  the message and keeps its HTTP details, which is what a host reads in a failure. */
function located<T>(
  check: () => T,
  details: { url: string; status: number; contentType: string },
): T {
  try {
    return check()
  } catch (error) {
    if (!(error instanceof EngineError)) throw error
    throw new EngineError(
      error.code,
      `${details.url}: ${error.message}, HTTP ${details.status}, type ${details.contentType}`,
      { ...error.details, ...details },
    )
  }
}
/** What the manifest cost to obtain: `json*` its root, `binary*` its pages and their column files,
 *  read and decoded. Reported as a diagnostic so a campaign can measure it. */
interface ManifestTiming {
  jsonBytes: number
  binaryBytes: number
  pointerMs: number
  jsonMs: number
  binaryMs: number
  totalMs: number
}
export interface LoadedManifest {
  pointer: Record<string, unknown>
  metadata: ClusterManifest
  metadataUrl: string
  base: string
  /** The length the manifest's `files` declare, by address: where a load's byte plan looks up
   *  the files it reads. Empty for a cache that declares none. */
  declared: ReadonlyMap<string, number>
  timing: ManifestTiming
  /** Of a manifest opened by its head (`lazy`), its mesh pages, which the view holds. */
  pages?: ManifestPages
  /** The load is over: the pages read from now on carry neither its signal nor its meter. */
  settle(): void
}

/** The length of each file the manifest's `files` list, by address. */
function declaredFiles(value: Record<string, unknown>, metadataUrl: string) {
  const files = new Map<string, number>()
  const listed = (value.files ?? {}) as Record<string, { bytes?: unknown } | undefined>
  for (const [name, file] of Object.entries(listed))
    if (typeof file?.bytes === 'number' && file.bytes > 0)
      files.set(new URL(name, metadataUrl).href, file.bytes)
  return files
}

/**
 * Reads the preparation pointer, then the cache it names. The `requested` scope is enforced when
 * the host names one — a pointer or a cache of another scope is refused by name —; left
 * undefined, the scope the pointer declares is the one read, and the cache is held to it.
 *
 * The cache's `clusters.json` is a root of fixed size, checked before anything else is fetched;
 * its pages and their column files are read side by side, each verified against its slot, and the
 * columns mapped, never parsed (`readPagedManifest`). `meter` counts each file read here as it
 * arrives; the load that holds it plans the files it reads next. `lazy` reads the head alone: the
 * mesh pages are read as `pages` holds them, checked and their addresses made absolute.
 */
export async function loadClusterManifest(
  manifestUrl: string,
  requested: AssetScope | undefined,
  signal?: AbortSignal,
  meter: ByteMeter = unmetered,
  lazy = false,
): Promise<LoadedManifest> {
  const started = performance.now()
  const pointerResource = await jsonResource(manifestUrl, signal, meter),
    pointer = pointerResource.value
  const pointerMs = performance.now() - started
  const declared = requested ?? (pointer as { scope?: AssetScope } | null)?.scope
  const pointerTarget = located(
    () => assertCachePointer(pointer, declared ?? DEFAULT_SCOPE),
    pointerResource.details,
  )
  const metadataUrl = new URL(pointerTarget, new URL(manifestUrl, location.href)).href
  const jsonStart = performance.now()
  const metadataResource = await jsonResource(metadataUrl, signal, meter),
    value = metadataResource.value
  const jsonMs = performance.now() - jsonStart
  // Readiness, scope and format are settled before the pages are worth a request. A pointer
  // that declares no scope leaves the cache's own to be read.
  const scope = declared ?? (value.scope as AssetScope)
  located(() => assertCacheRoot(value, scope), metadataResource.details)
  const binaryStart = performance.now()
  let binaryBytes = 0
  // What reads the pages the view holds later: the load's signal and meter until it settles.
  let reading: { signal?: AbortSignal; meter: ByteMeter } = { signal, meter }
  const read = async (page: { url: string; bytes: number; sha256: string }) => {
    const url = new URL(page.url, metadataUrl).href
    const bytes = await fetchVerified(url, page, reading.signal, reading.meter)
    binaryBytes += bytes.byteLength
    return new Uint8Array(bytes)
  }
  const base = new URL('.', metadataUrl).href
  // A page the view holds later is held to the head's identity, as the whole manifest is.
  const head: { manifest?: ClusterManifest } = {}
  const accept = (primitives: Primitive[]) => {
    assertCacheIdentity({ ...head.manifest!, primitives })
    return primitives.map((primitive) => absolutePrimitive(primitive, base))
  }
  const { metadata, pages } = lazy
    ? await openPagedManifest(value, read, accept)
    : { metadata: await readPagedManifest(value, read), pages: undefined }
  head.manifest = metadata
  located(() => assertCacheReady(metadata, scope), metadataResource.details)
  assertCacheIdentity(metadata)
  return {
    pointer,
    metadata,
    metadataUrl,
    base,
    pages,
    settle: () => void (reading = { meter: unmetered }),
    declared: declaredFiles(metadata as unknown as Record<string, unknown>, metadataUrl),
    timing: {
      jsonBytes: metadataResource.bytes,
      binaryBytes,
      pointerMs,
      jsonMs,
      binaryMs: performance.now() - binaryStart,
      totalMs: performance.now() - started,
    },
  }
}
