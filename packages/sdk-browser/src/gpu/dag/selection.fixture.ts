import type { PackedDag } from './selection.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import type { MapFaults } from '../../../../../tests/kit/gpu/mockBuffers.ts';
import { DAG_UNIFORM_BYTES } from './shader/viewsWgsl.ts';

/**
 * The kit's device (`mockGpu`) running the DAG selection on the CPU double of its kernel, with
 * the counts the selection tests read.
 */
export function mockDagDevice(packed: PackedDag, faults: MapFaults = {}) {
  const gpu = mockGpu({ packed, ...faults });
  return {
    device: gpu.device,
    uniformWrites: () => gpu.writes.filter(({ size }) => size === DAG_UNIFORM_BYTES).length,
    /** Copies to a READABLE slot: one per due readback, never one per send. */
    readbackCopies: () =>
      gpu.copies.filter(({ usage = 0 }) => usage & GPUBufferUsage.MAP_READ).length,
    /** Mappings asked of a destroyed buffer: each one a validation error on the device. */
    destroyedMaps: gpu.destroyedMaps,
  };
}
