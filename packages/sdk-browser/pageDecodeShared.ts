/**
 * Shared-memory page arena: the control zone, a slot's state, and waiting for its
 * wake. One writer per zone — each worker owns a slot and the region that matches
 * it, and it is the only one to write there; the main thread only reads.
 *
 * A slot's state lives in the control zone and changes only through `Atomics`:
 *
 *   `free` → `decoding` (the main thread arms the slot before posting the request)
 *          → `ready`    (the worker has finished writing its region and publishes)
 *          → `free`     (the main thread has copied the page out of the region)
 *
 * `lost` replaces `ready` when the worker dies mid-page: the wait wakes, the region
 * is not read, and the slot becomes `free` again. There is never a wait loop: the
 * main thread suspends once on `Atomics.waitAsync`, and the worker's state write
 * — a sequentially consistent atomic write — makes the region bytes written before
 * it visible at the same time.
 */
export const SHARED_FREE = 0,
  SHARED_READY = 2;
const SHARED_DECODING = 1,
  SHARED_LOST = 4;
/** The page arrived by buffer transfer (page too large, refusal, cancel), or by the
 *  shared region. The main thread reads the region only in the second case. */
export const SHARED_BY_REGION = 1;
const SHARED_BY_MESSAGE = 0;

/** A slot's fields, in 32-bit words, and the room reserved for each. */
export const MAX_SHARED_ATTRS = 8,
  ATTR_BASE = 10;
const SLOT_I32 = 32;
export const STATE = 0,
  ID = 1,
  STATUS = 2,
  VERTEX = 3,
  FLAGS = 4,
  DECODED = 5,
  WASM = 6,
  TASK_US = 7,
  INDEX_BYTES = 8,
  ATTRS = 9;
/** A slot's region. A page that does not fit leaves by transfer: the bound costs
 *  memory on every slot, so it is not sized for the format's worst case. */
export const SHARED_REGION_BYTES = 4 * 1024 * 1024;

export type PageArena = {
  buffer: SharedArrayBuffer;
  control: Int32Array;
  slots: number;
  /** First byte of the regions, just after the control zone. */
  base: number;
};

/** Asynchronous `Atomics` wait, missing from the repository TypeScript library (ES2023). */
type WaitAsync = (
  typedArray: Int32Array,
  index: number,
  value: number,
) =>
  | { async: false; value: 'not-equal' | 'timed-out' }
  | { async: true; value: Promise<'ok' | 'timed-out'> };
const waitAsync = () =>
  typeof Atomics === 'undefined'
    ? undefined
    : (Atomics as unknown as { waitAsync?: WaitAsync }).waitAsync;

/**
 * True when the page can read shared memory: cross-origin isolation is on,
 * `SharedArrayBuffer` exists, and the async wait does too — without it a loop
 * would be needed, which this path rejects. False everywhere else, and the
 * transfer path stays in place as-is.
 */
export function sharedPagesAllowed() {
  return (
    globalThis.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof waitAsync() === 'function'
  );
}

/** Path decoded pages will take, as announced to the explorer's capabilities. */
export function pageDecodeTransport(): 'partage' | 'transfert' {
  return sharedPagesAllowed() ? 'partage' : 'transfert';
}

const controlBytes = (slots: number) => slots * SLOT_I32 * 4;

/** A new arena for `slots` workers: control zone then one region per slot. */
export function createPageArena(slots: number): PageArena {
  return attachPageArena(
    new SharedArrayBuffer(controlBytes(slots) + slots * SHARED_REGION_BYTES),
    slots,
  );
}

/** The same arena as seen from the worker, which only receives the buffer and slot count. */
export function attachPageArena(buffer: SharedArrayBuffer, slots: number): PageArena {
  return {
    buffer,
    control: new Int32Array(buffer, 0, slots * SLOT_I32),
    slots,
    base: controlBytes(slots),
  };
}

export const slotField = (slot: number, field: number) => slot * SLOT_I32 + field;
export const regionAt = (arena: PageArena, slot: number) => arena.base + slot * SHARED_REGION_BYTES;
export const sharedField = (arena: PageArena, slot: number, field: number) =>
  Atomics.load(arena.control, slotField(slot, field));

/** The slot moves to `decoding` for request `id`: armed before the request is posted. */
export function beginSharedPage(arena: PageArena, slot: number, id: number) {
  Atomics.store(arena.control, slotField(slot, ID), id);
  Atomics.store(arena.control, slotField(slot, STATUS), SHARED_BY_MESSAGE);
  Atomics.store(arena.control, slotField(slot, STATE), SHARED_DECODING);
}

/**
 * Slot state once it has left `decoding`. A single suspend, never a loop: if the
 * worker has already published, `waitAsync` says so at once; otherwise its state
 * write wakes.
 */
export function awaitSharedPage(arena: PageArena, slot: number): Promise<number> {
  const index = slotField(slot, STATE);
  const read = () => Atomics.load(arena.control, index);
  const wait = waitAsync()!(arena.control, index, SHARED_DECODING);
  return wait.async ? wait.value.then(read) : Promise.resolve(read());
}

/** Marks lost the page of a slot whose worker just died, and wakes its wait. No
 *  effect on a slot that has already published: those bytes are complete and stay readable. */
export function loseSharedPage(arena: PageArena, slot: number) {
  const index = slotField(slot, STATE);
  const was = Atomics.compareExchange(arena.control, index, SHARED_DECODING, SHARED_LOST);
  if (was === SHARED_DECODING) Atomics.notify(arena.control, index);
}

/** The slot returns to service, whether its page was read or lost. */
export function freeSharedPage(arena: PageArena, slot: number) {
  Atomics.store(arena.control, slotField(slot, STATE), SHARED_FREE);
}
