import type { createGpuPageReader } from './reader.ts';

/** One page held in the GPU page pool. */
export interface ResidentPage {
  /** Its key. */
  key: string;
  /** Its slot in the pool. */
  slot: number;
  /** Its byte offset. */
  offset: number;
  /** Its size. */
  bytes: number;
  /** How many times its slot was reused. */
  generation: number;
}
/** An eviction order, its keys read one at a time as victims are taken. */
export type EvictionOrder = { readonly count: number; keyAt(at: number): string };
export type GpuPageContext = {
  device: GPUDevice;
  pageBytes: number;
  slots: number;
  buffer: GPUBuffer;
  resident: Map<string, ResidentPage>;
  pins: Set<string>;
  free: number[];
  staging: Uint8Array<ArrayBuffer>;
  abort: AbortController;
  fetches: Map<string, Promise<Uint8Array>>;
  state: {
    pending: Promise<unknown>;
    disposed: boolean;
    generation: number;
    bytesRead: number;
    uploadedBytes: number;
    evictions: number;
  };
  /** The order slots are given back in, when a GPU cut publishes one (`../dag/evict.ts`), and the
   *  first entry not taken yet; otherwise the least recently loaded or touched page goes first. */
  eviction: { order: EvictionOrder | undefined; at: number };
  changeKeys: string[];
  changeSlots: number[];
  reader: ReturnType<typeof createGpuPageReader>;
  check: (signal?: AbortSignal) => void;
};
