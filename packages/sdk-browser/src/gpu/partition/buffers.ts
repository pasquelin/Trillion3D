import {
  CORNER_VALUES,
  PARTITION_BINDING,
  PARTITION_KERNEL_BINDINGS,
  ROW_DATA_U32,
  STATE_WORDS,
  TESTED_U32,
  UNIFORM_U32,
} from './contract.ts';

/**
 * Buffers the GPU partition owns: they depend only on the drawable-row count, never on the frame.
 * Rest bits and per-slot counts are NOT here — they belong to the draw compact, which the
 * partition writes in their place.
 */
export function createGpuPartitionBuffers(device: GPUDevice, slotCap: number) {
  const rows = Math.max(1, slotCap);
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const corners = device.createBuffer({
    label: 'WG partition corners v1',
    size: rows * CORNER_VALUES * 4,
    usage: storage,
  });
  const rowData = device.createBuffer({
    label: 'WG partition rows v1',
    size: rows * ROW_DATA_U32 * 4,
    usage: storage | GPUBufferUsage.COPY_SRC,
  });
  const tested = device.createBuffer({
    label: 'WG partition tested bounds v1',
    size: rows * TESTED_U32 * 4,
    usage: storage | GPUBufferUsage.COPY_SRC,
  });
  const state = device.createBuffer({
    label: 'WG partition state v1',
    size: STATE_WORDS * 4,
    usage: storage | GPUBufferUsage.COPY_SRC,
  });
  const uniforms = device.createBuffer({
    label: 'WG partition uniform v1',
    size: UNIFORM_U32 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  return {
    rows,
    corners,
    rowData,
    tested,
    state,
    uniforms,
    all: [corners, rowData, tested, state, uniforms],
  };
}

type Binding = keyof typeof PARTITION_BINDING;
export type PartitionKernel = keyof typeof PARTITION_KERNEL_BINDINGS;
const BINDING_TYPE: Record<Binding, GPUBufferBindingType> = {
  corners: 'read-only-storage',
  items: 'read-only-storage',
  flags: 'storage',
  rowData: 'storage',
  tested: 'storage',
  restBits: 'storage',
  slotUsed: 'storage',
  state: 'storage',
  uniforms: 'uniform',
  pyramid: 'read-only-storage',
};
/** The bind layout of one kernel: its buffers alone, at the module's binding numbers. */
export function createGpuPartitionLayout(device: GPUDevice, kernel: PartitionKernel) {
  return device.createBindGroupLayout({
    entries: PARTITION_KERNEL_BINDINGS[kernel].map((name) => ({
      binding: PARTITION_BINDING[name],
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: BINDING_TYPE[name] },
    })),
  });
}

/** The bind group of one kernel, from the buffers by name. */
export function createGpuPartitionGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  kernel: PartitionKernel,
  buffers: Record<Binding, GPUBuffer>,
) {
  return device.createBindGroup({
    layout,
    entries: PARTITION_KERNEL_BINDINGS[kernel].map((name) => ({
      binding: PARTITION_BINDING[name],
      resource: { buffer: buffers[name] },
    })),
  });
}
