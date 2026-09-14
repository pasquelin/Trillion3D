import type { createGpuPageReader } from './gpuPageReader.ts';

export interface ResidentPage {
  key: string;
  slot: number;
  offset: number;
  bytes: number;
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
