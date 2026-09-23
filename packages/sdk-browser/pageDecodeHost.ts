import { PAGE_DECODE_PROTOCOL, pageDecodeWorkerCount } from '../sdk-core/src/index.ts';
import { createPageDecodePool, type PageDecodePool } from './pageDecodePool.ts';
import { restorePageDecode, runPageDecodeTask } from './pageDecodeTask.ts';
import { createPageArena, sharedPagesAllowed } from './pageDecodeShared.ts';
import type { DecodedGeometryPage } from './geometryPage.ts';
import type { PageDecodeAnswer, PageDecodeOp } from '../sdk-core/src/index.ts';
import type { PageCutPayload } from '../sdk-core/src/page/decodeContracts.ts';

/** Decoded-byte ceiling of a page, identical to the original synchronous path. */
const MAX_DECODED_BYTES = 16 * 1024 * 1024;
const counters = { tasks: 0, offThread: 0, wasm: 0, decodeMs: 0 };
let admissionLimit = 1,
  pool: PageDecodePool | undefined;
/** `undefined` until the startup check has answered, then its verdict; `starting` is that check. */
let started: boolean | undefined, starting: Promise<unknown> | undefined;

/** Bounds the pool to the admission already in force for page transfers. Call before the
 *  first decode; a later call does not resize an already-open pool. */
export function configurePageDecoders(limit: number) {
  admissionLimit = limit;
}

/**
 * The pool if its startup probe has already succeeded, `undefined` otherwise. The probe is
 * launched but **never awaited**: until it has answered, and always if it does not, decode
 * stays on the main thread. A page therefore never depends on a worker starting, and no
 * real buffer is transferred before a worker has proved it lives — a failed start
 * (platform without `Worker`, missing module, host-unresolved dependency) leaves the
 * caller its bytes intact.
 */
function openPool() {
  if (started === false) return undefined;
  if (!pool) {
    if (typeof Worker === 'undefined') {
      started = false;
      return undefined;
    }
    const cores = (globalThis.navigator as { hardwareConcurrency?: number } | undefined)
      ?.hardwareConcurrency;
    const workers = pageDecodeWorkerCount(cores, admissionLimit);
    // The arena is allocated only where the platform allows it, and only at pool open:
    // a page that never decodes anything does not pay for shared memory.
    pool = createPageDecodePool(
      workers,
      sharedPagesAllowed() ? createPageArena(workers) : undefined,
    );
    starting = pool.start().then((ok) => {
      started = ok;
      if (!ok) pool = undefined;
    });
  }
  // A pool broken after start does not come back: its workers are gone, and relaunching
  // the probe on every page would turn a failure into a loop. Fallback takes over for good.
  if (started && !pool.alive) started = false;
  return started ? pool : undefined;
}

function count(answer: PageDecodeAnswer, offThread: boolean) {
  counters.tasks++;
  if (offThread) counters.offThread++;
  if (answer.ok) {
    counters.decodeMs += answer.taskMs;
    if (answer.wasm) counters.wasm++;
  }
  return answer;
}
function refuse(answer: PageDecodeAnswer): never {
  throw new Error(answer.ok ? 'PAGE_DECODE_FAILED' : answer.message);
}
/** A view's buffer, without a copy when the view covers it as an integer — what every cache
 *  page does — and a copy otherwise: the task reads an `ArrayBuffer`, never a leftover shared buffer. */
function ownBuffer(bytes: Uint8Array) {
  return (
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer
  ) as ArrayBuffer;
}
/** Fallback: the contract task, the same function, run on the main thread. */
async function onThread(op: PageDecodeOp, source: ArrayBuffer) {
  const { answer } = await runPageDecodeTask({
    protocol: PAGE_DECODE_PROTOCOL,
    id: 0,
    op,
    source,
    maxDecodedBytes: MAX_DECODED_BYTES,
  });
  return count(answer, false);
}

/**
 * SHA-256 digest of a freshly read page. **The caller yields its buffer**: the worker
 * receives it transferred, hence without a copy, and returns it transferred too. It is
 * the returned buffer — the return value's — that must be read next; the original
 * reference is detached.
 */
export async function verifyPageBytes(source: ArrayBuffer) {
  const open = openPool();
  const answer = open
    ? count(await open.submit('verify', source, 0).answer, true)
    : await onThread('verify', source);
  if (!answer.ok || !answer.source || answer.sha256 === null) refuse(answer);
  return { sha256: answer.sha256, source: answer.source };
}

/**
 * Indices and attributes of a geometry page, decoded off the main thread when the
 * platform allows, and by the same function on the main thread otherwise.
 *
 * The worker receives a copy of the compressed bytes, not the cache buffer: detaching
 * a page-cache entry would break its byte accounting, which eviction reads on the
 * main thread during the round-trip. The copy carries the compressed page; what
 * comes back — the decoded buffers, much larger — is transferred without a copy.
 */
export async function decodePageOffThread(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<DecodedGeometryPage> {
  const open = openPool();
  let answer: PageDecodeAnswer;
  if (open) {
    const task = open.submit('decode', bytes.slice().buffer as ArrayBuffer, MAX_DECODED_BYTES);
    const cancel = () => open.cancel(task.id);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      answer = await task.answer;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    // A vanished worker, or a worker without a decoder, loses nothing: the compressed
    // bytes stayed with the caller, and the main thread can do the same work.
    if (
      !answer.ok &&
      (answer.code === 'PAGE_DECODE_WORKER' || answer.code === 'PAGE_DECODE_UNAVAILABLE')
    )
      answer = await onThread('decode', ownBuffer(bytes));
    else count(answer, true);
  } else answer = await onThread('decode', ownBuffer(bytes));
  signal?.throwIfAborted();
  if (!answer.ok || !answer.decoded) refuse(answer);
  return restorePageDecode(answer.decoded);
}

/**
 * Drawn triangles, packed by `packDrawn`, cut into pages in a worker when the pool lives and by
 * the same task on the main thread otherwise. **The caller yields its buffer.** A cut is not a
 * decode: it is not counted among the decoded pages.
 */
export async function cutPagesOffThread(packed: ArrayBuffer): Promise<PageCutPayload> {
  // A cut is never urgent: it waits for the pool's startup check rather than take the main thread.
  if (!openPool() && started === undefined) await starting;
  const open = openPool();
  // The worker receives a copy: a vanished worker leaves the original for the main thread.
  let answer = open ? await open.submit('cut', packed.slice(0), 0).answer : undefined;
  if (!answer || (!answer.ok && answer.code === 'PAGE_DECODE_WORKER'))
    answer = (
      await runPageDecodeTask({
        protocol: PAGE_DECODE_PROTOCOL,
        id: 0,
        op: 'cut',
        source: packed,
        maxDecodedBytes: 0,
      })
    ).answer;
  if (!answer.ok || !answer.cut) refuse(answer);
  return answer.cut;
}

/** Off-thread decoded pages, pages decoded by the WebAssembly module, cumulative decode
 *  time, pool size. `null` when nothing was decoded: an unmeasured metric is not a zero. */
export function pageDecodeStats() {
  if (!counters.tasks) return { offThread: null, wasm: null, decodeMs: null, workers: null };
  return {
    offThread: counters.offThread,
    wasm: counters.wasm,
    decodeMs: counters.decodeMs,
    workers: pool?.alive ? pool.workers : 0,
  };
}

/** Closes the pool without cutting an in-flight decode and resets counters to unmeasured. */
export function releasePageDecoders() {
  pool?.retire();
  pool = undefined;
  started = starting = undefined;
  counters.tasks = 0;
  counters.offThread = 0;
  counters.wasm = 0;
  counters.decodeMs = 0;
}
