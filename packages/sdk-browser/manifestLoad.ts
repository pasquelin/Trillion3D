import {
  assertCacheIdentity,
  assertCachePointer,
  assertCacheReady,
  assertManifestBinary,
  decodeManifestBinary,
  EngineError,
  isBinaryManifest,
  type AssetScope,
  type ClusterManifest,
  type SlimClusterManifest,
} from '../sdk-core/index.ts';
import { checked } from './clusterPages.ts';

async function jsonResource(
  url: string,
  signal?: AbortSignal,
): Promise<{
  value: Record<string, unknown>;
  details: { url: string; status: number; contentType: string };
  bytes: number;
}> {
  const response = await checked(url, signal),
    contentType = response.headers.get('content-type') ?? '';
  const details = { url, status: response.status, contentType };
  if (!/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(contentType))
    throw new EngineError(
      'INVALID_JSON_RESPONSE',
      `${url}: JSON attendu, HTTP ${response.status}, type ${contentType || 'absent'}`,
      details,
    );
  // `response.json()` parses the bytes without ever materialising the text; the declared length is
  // enough for the diagnostic, and reading the body twice to count would cost more than it reports.
  const declared = Number(response.headers.get('content-length'));
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new EngineError(
      'INVALID_JSON_RESPONSE',
      `${url}: JSON invalide, HTTP ${response.status}, type ${contentType}`,
      details,
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EngineError(
      'INVALID_JSON_RESPONSE',
      `${url}: objet JSON attendu, HTTP ${response.status}, type ${contentType}`,
      details,
    );
  return {
    value: value as Record<string, unknown>,
    details,
    bytes: Number.isFinite(declared) ? declared : 0,
  };
}

/** The public checks know the format, not the response that carried it: this names the resource in
 *  the message and keeps its HTTP details, which is what a host reads in a failure. */
function located<T>(
  check: () => T,
  details: { url: string; status: number; contentType: string },
): T {
  try {
    return check();
  } catch (error) {
    if (!(error instanceof EngineError)) throw error;
    throw new EngineError(
      error.code,
      `${details.url}: ${error.message}, HTTP ${details.status}, type ${details.contentType}`,
      { ...error.details, ...details },
    );
  }
}
/** What the manifest cost to obtain. Reported as a diagnostic so a campaign can measure it. */
interface ManifestTiming {
  format: 'json' | 'binary';
  jsonBytes: number;
  binaryBytes: number;
  pointerMs: number;
  jsonMs: number;
  binaryMs: number;
  decodeMs: number;
  totalMs: number;
}
export interface LoadedManifest {
  pointer: Record<string, unknown>;
  metadata: ClusterManifest;
  metadataUrl: string;
  base: string;
  timing: ManifestTiming;
}

/**
 * Reads the preparation pointer, then the cache it names.
 *
 * A cache compiled with a binary sidecar hands over a small JSON and a column file: the columns are
 * mapped, never parsed, so the cost of reading a manifest stops growing with the cluster count. A
 * cache without one is read exactly as before, so older caches stay loadable.
 */
export async function loadClusterManifest(
  manifestUrl: string,
  scope: AssetScope,
  signal?: AbortSignal,
): Promise<LoadedManifest> {
  const started = performance.now();
  const pointerResource = await jsonResource(manifestUrl, signal),
    pointer = pointerResource.value;
  const pointerMs = performance.now() - started;
  const pointerTarget = located(() => assertCachePointer(pointer, scope), pointerResource.details);
  const metadataUrl = new URL(pointerTarget, new URL(manifestUrl, location.href)).href;
  const jsonStart = performance.now();
  const metadataResource = await jsonResource(metadataUrl, signal),
    value = metadataResource.value;
  const jsonMs = performance.now() - jsonStart;
  // Readiness, scope and format are settled before the columns are worth a request.
  located(() => assertCacheReady(value, scope), metadataResource.details);
  let metadata: ClusterManifest,
    binaryBytes = 0,
    binaryMs = 0,
    decodeMs = 0,
    format: 'json' | 'binary' = 'json';
  if (isBinaryManifest(value)) {
    format = 'binary';
    assertManifestBinary(value.binary);
    const binaryUrl = new URL((value.binary as { url: string }).url, metadataUrl).href;
    const binaryStart = performance.now();
    const buffer = await (await checked(binaryUrl, signal)).arrayBuffer();
    binaryMs = performance.now() - binaryStart;
    binaryBytes = buffer.byteLength;
    const declared = (value.binary as { bytes: number }).bytes;
    if (buffer.byteLength !== declared)
      throw new EngineError(
        'INVALID_CACHE',
        `${binaryUrl}: ${buffer.byteLength} octets reçus, ${declared} annoncés`,
        { url: binaryUrl, bytes: buffer.byteLength, expected: declared },
      );
    const decodeStart = performance.now();
    metadata = decodeManifestBinary(value as unknown as SlimClusterManifest, buffer);
    decodeMs = performance.now() - decodeStart;
  } else metadata = value as unknown as ClusterManifest;
  assertCacheIdentity(metadata);
  const base = new URL('.', metadataUrl).href;
  return {
    pointer,
    metadata,
    metadataUrl,
    base,
    timing: {
      format,
      jsonBytes: metadataResource.bytes,
      binaryBytes,
      pointerMs,
      jsonMs,
      binaryMs,
      decodeMs,
      totalMs: performance.now() - started,
    },
  };
}
