import type { createGpuPageReader } from './reader.ts';
import { type EvictionOrder } from './evictionOrder.ts';

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
export type GpuPageContext = {
  device: GPUDevice;
  pageBytes: number;
  slots: number;
  buffer: GPUBuffer;
  resident: Map<string, ResidentPage>;
  pins: Set<string>;
  held: Set<string>;
  free: number[];
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
  /** The order slots are given back in, when a GPU cut publishes one (`../dag/evict.ts`), its next
   *  entry and those set aside (`commit.ts`), and the orders published; else the least recent. */
  eviction: {
    order?: EvictionOrder;
    at: number;
    epoch: number;
    lower: Map<string, number>;
    held: string[];
    late: string[];
    lateAt: number;
  };
  changeKeys: string[];
  changeSlots: number[];
  reader: ReturnType<typeof createGpuPageReader>;
  check: (signal?: AbortSignal) => void;
};
