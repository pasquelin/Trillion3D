/**
 * Off-main-thread page-decode contract, version 3.
 *
 * The calling thread sends a `PageDecodeRequest`, the executor returns a `PageDecodeAnswer` carrying
 * the same `id`. Nothing here touches the platform: no `Worker`, no fetch, no clock — the browser
 * adapter carries all of that, this file only carries the message shape, the closed list of
 * failures and the pool bound.
 *
 * Buffer ownership: `source` is **transferred** with the request, so the sender no longer owns
 * it. A `verify` response returns it, transferred in turn; a `decode` response returns the decoded
 * buffers instead, also transferred. An executor that transfers nothing (the synchronous fallback)
 * returns exactly the same values: the contract does not say how the work travels, only what it
 * returns.
 */
export const PAGE_DECODE_PROTOCOL = 3;

/** `verify`: a page's SHA-256 digest. `decode`: its indices and per-vertex attributes. */
export type PageDecodeOp = 'verify' | 'decode';

export interface PageDecodeRequest {
  protocol: number;
  id: number;
  op: PageDecodeOp;
  /** Transferred with the message: the sender is no longer the owner. */
  source: ArrayBuffer;
  /** Ceiling of decoded bytes of a geometry page; ignored by `verify`. */
  maxDecodedBytes: number;
}

/**
 * A worker's shared-memory lease: the arena buffer, the slot and the region it
 * owns, and the slot count, which gives the size of the control zone. Posted once,
 * at worker birth, and only where the platform allows shared memory.
 * Without a lease, the worker answers by transferring buffers: the contract does not change shape,
 * only the byte path does.
 */
export interface PageDecodeShare {
  protocol: number;
  id: 0;
  op: 'share';
  buffer: SharedArrayBuffer;
  slot: number;
  slots: number;
}

/** Cancellation of a request still in the queue. Work already started runs to completion then answers
 *  `PAGE_DECODE_CANCELLED`: the executor has no interrupt point in the middle of a decode. */
export interface PageDecodeCancel {
  protocol: number;
  id: number;
  op: 'cancel';
}

/** A decoded page as one buffer of `decodedBytes`: the 32-bit indices, then the floats of each
 *  attribute `names` lists, in the decode write order — that order is what yields a
 *  field-for-field identical `Record`. */
export interface PageDecodeGeometryPayload {
  block: ArrayBuffer;
  names: string[];
  vertexCount: number;
  flags: number;
  decodedBytes: number;
  /** The page header's largest position displacement, in object units. */
  quantizationError: number;
}

export interface PageDecodeDone {
  protocol: number;
  id: number;
  ok: true;
  /** `verify`: the lowercase hexadecimal digest. `decode`: `null`. */
  sha256: string | null;
  /** `verify`: the source buffer returned. `decode`: `null`, the source is consumed. */
  source: ArrayBuffer | null;
  decoded: PageDecodeGeometryPayload | null;
  /** True when the WebAssembly-compiled decoder did the work, false for the
   *  JavaScript decoder. Both yield the same bytes; only the counter distinguishes them. */
  wasm: boolean;
  /** Task time, measured by the executor itself. */
  taskMs: number;
}

/**
 * Failure semantics, closed list. The first six are the page-decode rejections, taken word
 * for word from `geometryPage.ts`: a caller distinguishes them as before. `PAGE_DECODE_FAILED` carries
 * any other rejection from the decompression library. `PAGE_DECODE_CANCELLED` answers a
 * cancellation, `PAGE_DECODE_WORKER` an executor that vanished — only that one allows the fallback.
 */
export const PAGE_DECODE_FAILURES = [
  'GEOMETRY_PAGE_HEADER',
  'GEOMETRY_PAGE_VERSION',
  'GEOMETRY_PAGE_BOUNDS',
  'GEOMETRY_PAGE_INDEX',
  'GEOMETRY_PAGE_NONFINITE',
  'PAGE_DECODE_FAILED',
  'PAGE_DECODE_CANCELLED',
  'PAGE_DECODE_UNAVAILABLE',
  'PAGE_DECODE_WORKER',
] as const;
export type PageDecodeFailureCode = (typeof PAGE_DECODE_FAILURES)[number];

export interface PageDecodeFailed {
  protocol: number;
  id: number;
  ok: false;
  code: PageDecodeFailureCode;
  /** The original message, as-is: the caller raises the same `Error` as the synchronous path. */
  message: string;
}
export type PageDecodeAnswer = PageDecodeDone | PageDecodeFailed;

/** The named rejection that matches a message, or `PAGE_DECODE_FAILED` for everything else. */
export function pageDecodeFailureCode(message: string): PageDecodeFailureCode {
  for (const code of PAGE_DECODE_FAILURES) if (code === message) return code;
  return 'PAGE_DECODE_FAILED';
}

/**
 * Size of the decode pool: never more than the cores the machine reports, never more than
 * the package ceiling, never more than the admission bound already in force on transfers, and
 * at least one. A missing or non-integer value equals a single executor: on a platform that
 * reports nothing, we do not invent parallelism.
 */
export function pageDecodeWorkerCount(
  hardwareConcurrency: number | undefined,
  admissionLimit: number,
  ceiling = 4,
) {
  const cores = Number.isSafeInteger(hardwareConcurrency) ? (hardwareConcurrency as number) : 1;
  const admission = Number.isSafeInteger(admissionLimit) ? admissionLimit : 1;
  return Math.max(1, Math.min(cores, ceiling, admission));
}
