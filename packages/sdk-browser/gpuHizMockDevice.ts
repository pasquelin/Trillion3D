/**
 * L'appareil minimal que le Hi-Z demande, pour les tests qui l'observent sans carte graphique.
 * Les constantes d'usage sont posées à l'import : la fabrique les lit au moment où elle alloue.
 */
Object.assign(globalThis, {
  GPUBufferUsage: { MAP_READ: 1, COPY_DST: 8, COPY_SRC: 16, UNIFORM: 64, STORAGE: 128 },
  GPUTextureUsage: { TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 },
  GPUShaderStage: { COMPUTE: 4 },
});

export type HizDeviceOverrides = Partial<{
  createBuffer: (options: { size: number }) => unknown;
  createTexture: (options: { format?: string }) => unknown;
  queue: unknown;
}>;

/** The compute-capable device the Hi-Z pyramid needs, with the hooks a test observes overridden. */
export function hizDevice(overrides: HizDeviceOverrides = {}) {
  return {
    createBuffer: ({ size }: { size: number }) => ({ size, destroy() {} }),
    createTexture: ({ format }: { format?: string }) => ({
      format,
      destroy() {},
      createView() {
        return { format };
      },
    }),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createComputePipeline: ({ compute }: { compute: { entryPoint: string } }) => compute,
    createBindGroup: () => ({}),
    queue: { writeBuffer() {} },
    ...overrides,
  } as unknown as GPUDevice;
}

/** L'encodeur minimal que `encodeTest` demande : un effacement et une passe de calcul. */
export const hizEncoder = () =>
  ({
    clearBuffer() {},
    beginComputePass: () => ({
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups() {},
      end() {},
    }),
  }) as unknown as GPUCommandEncoder;

/** Un appareil qui note les téléversements vers le tampon de boîtes, reconnu par sa taille. */
export function hizBoundsWatcher(boundsBytes: number) {
  const writes: Array<{ offset: number; length: number; data: ArrayBuffer }> = [];
  const device = hizDevice({
    queue: {
      writeBuffer(
        buffer: { size: number },
        offset: number,
        data: ArrayBuffer,
        start: number,
        length: number,
      ) {
        if (buffer.size === boundsBytes)
          writes.push({ offset, length, data: data.slice(start, start + length) });
      },
    },
  });
  return { device, writes };
}
