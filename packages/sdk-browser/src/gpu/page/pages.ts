import type { PageSource } from '../../../../sdk-core/src/index.ts';
import type { BackendDiagnostic } from '../../backend/types.ts';
import { createGpuPageReader } from './reader.ts';
import { createGpuPageLoader } from './load.ts';
import { createGpuPagePins } from './pins.ts';
import { createPageBuffer, pageBufferBytes, resizeGpuPages } from './resize.ts';
import { evictResident } from './commit.ts';
import { checked, ONE_REQUEST } from '../../cluster/checked.ts';
import type { ResidentPage, GpuPageContext } from './types.ts';
export type { ResidentPage } from './types.ts';
/** WebGPU allocation/queue boundary. Page bytes and policy are supplied by the host. Queue writes are ordered; dispose waits for in-flight submits before destroy.
 * `pin(key, 'held')` keeps a page ahead of ordinary pins during `resize(slots)`, which no longer accepts a held set. Ordinary repinning preserves the held tier; `unpin(key)` removes it. */
export function createGpuPageCache(
  device: GPUDevice,
  source: PageSource,
  options: { pageBytes: number; slots: number; onDiagnostic?: (d: BackendDiagnostic) => void },
) {
  const { pageBytes, slots } = options;
  if (!Number.isSafeInteger(pageBytes) || pageBytes < 4 || pageBytes % 4)
    throw new Error('INVALID_PAGE_BUDGET');
  const buffer = createPageBuffer(device, pageBufferBytes(device, pageBytes, slots));
  const resident = new Map<string, ResidentPage>(),
    pins = new Set<string>(),
    held = new Set<string>(),
    free = Array.from({ length: slots }, (_, i) => i),
    tail = new Uint8Array(4),
    abort = new AbortController();
  const fetches = new Map<string, Promise<Uint8Array>>();
  const state = {
    pending: Promise.resolve() as Promise<unknown>,
    disposed: false,
    generation: 0,
    bytesRead: 0,
    uploadedBytes: 0,
    evictions: 0,
  };
  // Every arrival and departure in order, so a host mirrors the cache page by page instead of asking
  // for all of its catalogue every frame. `changeSlots[i]` is the words offset of the slot, or -1.
  const changeKeys: string[] = [],
    changeSlots: number[] = [];
  const reader = createGpuPageReader(source, pageBytes, options.onDiagnostic, fetches);
  const { emit } = reader;
  emit('gpu-page-catalogue', 'GPU cache configured', () => ({
    version: 1,
    pageBytes,
    slots,
    allocatedBytes: pageBytes * slots,
    source: 'host-page-source',
    drawDetached: false,
  }));
  const check = (signal?: AbortSignal) => {
    if (state.disposed) {
      emit('gpu-page-error', 'Operation refused after dispose', () => ({
        version: 1,
        error: 'PAGE_CACHE_DISPOSED',
      }));
      throw new Error('PAGE_CACHE_DISPOSED');
    }
    signal?.throwIfAborted();
  };
  const context: GpuPageContext = {
    device,
    pageBytes,
    slots,
    buffer,
    resident,
    pins,
    held,
    free,
    tail,
    abort,
    fetches,
    state,
    eviction: { at: 0, epoch: 0, lower: new Map(), held: [], late: [], lateAt: 0 },
    changeKeys,
    changeSlots,
    reader,
    check,
  };
  const pinning = createGpuPagePins(context);
  const load = createGpuPageLoader(context, pinning.pin);
  return {
    /** The pool buffer: a new identity after `resize`, to be rebound. */
    get buffer() {
      return context.buffer;
    },
    load,
    /**
     * Changes the pool size while keeping its pages, behind in-flight loads: nothing is written
     * into a buffer while it is being copied. The cache keeps held pins before ordinary pins.
     * Returns keys evicted for lack of room.
     */
    resize(slots: number) {
      const operation = state.pending.then(() => {
        check();
        return resizeGpuPages(context, slots);
      });
      state.pending = operation.catch(() => {});
      return operation;
    },
    get(key: string) {
      return resident.get(key);
    },
    /** Evicts in `order` from now on: an arrival takes the slot of its first resident, unpinned page
     *  not taken yet, never of a page it leaves out. `undefined` goes back to the least recent. */
    evictInOrder(order?: { readonly count: number; keyAt(at: number): string }) {
      Object.assign(context.eviction, { order, at: 0, lateAt: 0 });
      context.eviction.epoch++;
      context.eviction.held.length = context.eviction.late.length = 0;
    },
    /** Membership changes increase this counter; LRU touches do not. Callers with a verdict from
     * `get` can compare it instead of querying every page again. */
    get residencyRevision() {
      return state.generation + state.evictions;
    },
    /** Moves the pending residency changes into the caller's arrays, then empties the log. */
    drainResidencyChanges(keys: string[], slots: number[]) {
      for (let i = 0; i < changeKeys.length; i++) {
        keys.push(changeKeys[i]);
        slots.push(changeSlots[i]);
      }
      changeKeys.length = 0;
      changeSlots.length = 0;
    },
    ...pinning,
    unload(key: string) {
      const page = resident.get(key);
      if (!page) {
        emit('gpu-page-unload-refused', 'GPU unload refused', () => ({
          version: 1,
          key,
          reason: 'not-resident',
        }));
        return false;
      }
      if (pins.has(key)) {
        emit('gpu-page-unload-refused', 'GPU unload refused', () => ({
          version: 1,
          key,
          slot: page.slot,
          generation: page.generation,
          reason: 'pinned',
        }));
        return false;
      }
      evictResident(context, page, 'explicit-unload');
      free.push(page.slot);
      return true;
    },
    stats() {
      return {
        allocatedBytes: pageBytes * context.slots,
        slots: context.slots,
        residentPages: resident.size,
        bytesRead: state.bytesRead,
        uploadedBytes: state.uploadedBytes,
        evictions: state.evictions,
        physicalVramBytes: null,
      };
    },
    dispose() {
      if (state.disposed) return state.pending.then(() => {});
      emit('gpu-page-dispose', 'GPU cache released', () => ({
        version: 1,
        resident: resident.size,
        loading: fetches.size,
        evictions: state.evictions,
      }));
      state.disposed = true;
      abort.abort();
      resident.clear();
      pins.clear();
      held.clear();
      state.pending = state.pending
        .catch(() => {})
        .then(async () => {
          try {
            await device.queue.onSubmittedWorkDone();
          } catch {
            /* Queue may already be lost. */
          }
          context.buffer.destroy();
        });
      return state.pending;
    },
  };
}
/** A page source that fetches pages over HTTP, by key, from `baseUrl`. */
export function httpPageSource(baseUrl: string): PageSource {
  return {
    async read(key, signal) {
      const response = await checked(new URL(key, baseUrl).href, signal, ONE_REQUEST);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
