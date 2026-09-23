type Copy = { from?: number[]; to?: number[]; size: number[] };

/** A dummy texture device: it notes copies and destroyed textures. */
export function textureDevice() {
  const copies: Copy[] = [];
  let destroyed = 0;
  const gpu = {
    createTexture: () => ({
      createView: () => ({}),
      destroy: () => destroyed++,
      format: 'rgba8unorm',
    }),
    createBuffer: () => ({ destroy() {} }),
    createCommandEncoder: () => ({
      copyTextureToTexture: (
        from: { origin?: number[] },
        to: { origin?: number[] },
        size: number[],
      ) => copies.push({ from: from.origin, to: to.origin, size }),
      finish: () => ({}),
    }),
    queue: { writeTexture() {}, writeBuffer() {}, submit() {} },
  };
  return { gpu: gpu as never, copies, destroyed: () => destroyed };
}
