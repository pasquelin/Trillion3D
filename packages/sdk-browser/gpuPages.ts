import type { PageSource } from '../sdk-core/index.ts';
import type { BackendDiagnostic } from './backendTypes.ts';
import { createGpuPageReader } from './gpuPageReader.ts';
import { createGpuPageLoader } from './gpuPageLoad.ts';
import { createGpuPagePins } from './gpuPagePins.ts';
import type { ResidentPage, GpuPageContext } from './gpuPageTypes.ts';
export type { ResidentPage } from './gpuPageTypes.ts';
/** WebGPU allocation/queue boundary. Page bytes and policy are supplied by the host. Queue writes are ordered; dispose waits for in-flight submits before destroy. */
export function createGpuPageCache(
  device: GPUDevice,
  source: PageSource,
  options: {
    pageBytes: number;
    slots: number;
    onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
  },
) {
  const { pageBytes, slots } = options,
    size = pageBytes * slots;
  if (
    !Number.isSafeInteger(pageBytes) ||
    pageBytes < 4 ||
    pageBytes % 4 ||
    !Number.isSafeInteger(slots) ||
    slots < 1 ||
    size > device.limits.maxBufferSize
  )
    throw new Error('INVALID_PAGE_BUDGET');
  if (
    device.limits.maxStorageBufferBindingSize !== undefined &&
    size > device.limits.maxStorageBufferBindingSize
  )
    throw new Error('INVALID_PAGE_BUDGET');
  const buffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const resident = new Map<string, ResidentPage>(),
    pins = new Set<string>(),
    free = Array.from({ length: slots }, (_, i) => i),
    staging = new Uint8Array(pageBytes),
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
  emit('gpu-page-catalogue', 'Cache GPU configuré', () => ({
    version: 1,
    pageBytes,
    slots,
    allocatedBytes: size,
    source: 'host-page-source',
    drawDetached: false,
  }));
  const check = (signal?: AbortSignal) => {
    if (state.disposed) {
      emit('gpu-page-error', 'Opération refusée après dispose', () => ({
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
    free,
    staging,
    abort,
    fetches,
    state,
    changeKeys,
    changeSlots,
    reader,
    check,
  };
  const load = createGpuPageLoader(context);
  const pinning = createGpuPagePins(context);
  return {
    buffer,
    load,
    get(key: string) {
      return resident.get(key);
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
        emit('gpu-page-unload-refused', 'Déchargement GPU refusé', () => ({
          version: 1,
          key,
          reason: 'not-resident',
        }));
        return false;
      }
      if (pins.has(key)) {
        emit('gpu-page-unload-refused', 'Déchargement GPU refusé', () => ({
          version: 1,
          key,
          slot: page.slot,
          generation: page.generation,
          reason: 'pinned',
        }));
        return false;
      }
      resident.delete(key);
      changeKeys.push(key);
      changeSlots.push(-1);
      free.push(page.slot);
      state.evictions++;
      emit('gpu-page-eviction', 'Page retirée de la résidence GPU', () => ({
        version: 1,
        key,
        slot: page.slot,
        generation: page.generation,
        bytes: page.bytes,
        reason: 'explicit-unload',
        drawDetached: false,
      }));
      return true;
    },
    stats() {
      return {
        allocatedBytes: size,
        residentPages: resident.size,
        bytesRead: state.bytesRead,
        uploadedBytes: state.uploadedBytes,
        evictions: state.evictions,
        physicalVramBytes: null,
      };
    },
    dispose() {
      if (state.disposed) return state.pending.then(() => {});
      emit('gpu-page-dispose', 'Cache GPU libéré', () => ({
        version: 1,
        resident: resident.size,
        loading: fetches.size,
        evictions: state.evictions,
      }));
      state.disposed = true;
      abort.abort();
      resident.clear();
      pins.clear();
      state.pending = state.pending
        .catch(() => {})
        .then(async () => {
          try {
            await device.queue.onSubmittedWorkDone();
          } catch {
            /* Queue may already be lost. */
          }
          buffer.destroy();
        });
      return state.pending;
    },
  };
}
export function httpPageSource(baseUrl: string): PageSource {
  return {
    async read(key, signal) {
      const response = await fetch(new URL(key, baseUrl), { signal });
      if (!response.ok) throw new Error(`PAGE_HTTP_${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
