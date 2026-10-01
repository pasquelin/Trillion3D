const layouts = new WeakMap<GPUDevice, GPUBindGroupLayout>();
export function reflectionLayout(device: GPUDevice) {
  let layout = layouts.get(device);
  if (!layout) {
    layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
      ],
    });
    layouts.set(device, layout);
  }
  return layout;
}

/** The bindings of the rough reflection resolve (`resolveWgsl.ts`). */
export function reflectionResolveLayout(device: GPUDevice) {
  const visibility = GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    entries: [
      ...Array.from({ length: 8 }, (_, binding) => ({
        binding,
        visibility,
        texture: {
          sampleType: (binding === 2 || binding === 5
            ? 'depth'
            : binding === 4 || binding === 7
              ? 'uint'
              : 'unfilterable-float') as GPUTextureSampleType,
        },
      })),
      { binding: 8, visibility, buffer: { type: 'uniform' } },
      { binding: 9, visibility, buffer: { type: 'read-only-storage' } },
      { binding: 10, visibility, buffer: { type: 'read-only-storage' } },
    ],
  });
}
