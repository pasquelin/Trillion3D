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
  changeKeys: string[];
  changeSlots: number[];
  reader: ReturnType<typeof createGpuPageReader>;
  check: (signal?: AbortSignal) => void;
};
