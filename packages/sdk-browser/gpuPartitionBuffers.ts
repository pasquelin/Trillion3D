import {
  CORNER_VALUES,
  ROW_DATA_U32,
  STATE_WORDS,
  TESTED_U32,
  UNIFORM_U32,
} from './gpuPartitionContract.ts';

/**
 * Les tampons que la partition GPU possède : ils ne dépendent que du nombre de lignes dessinables,
 * jamais de l'image. Les bits de reste et les comptes par slot ne sont PAS ici — ce sont ceux de la
 * compaction de dessin, que la partition écrit à sa place.
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

/** La disposition de liaison du module : huit tampons de stockage, puis l'uniforme. */
export function createGpuPartitionLayout(device: GPUDevice) {
  const kinds: GPUBufferBindingType[] = [
    'read-only-storage',
    'read-only-storage',
    'storage',
    'storage',
    'storage',
    'storage',
    'storage',
    'storage',
    'uniform',
  ];
  return device.createBindGroupLayout({
    entries: kinds.map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
}
