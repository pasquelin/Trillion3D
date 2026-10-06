import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'

const layouts = new WeakMap<GPUDevice, GPUBindGroupLayout>()
export function reflectionLayout(device: GPUDevice) {
  let layout = layouts.get(device)
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
    })
    layouts.set(device, layout)
  }
  return layout
}

/** The rough trace's third group: the record it writes of each texel's pixel (`sampleWgsl.ts`). */
export const reflectionOwnerLayout = oncePerDevice((device) =>
  device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        storageTexture: { access: 'write-only', format: 'rg32uint' },
      },
    ],
  }),
)

/** The bindings of the rough reflection resolve (`resolveWgsl.ts`). */
export function reflectionResolveLayout(device: GPUDevice) {
  const visibility = GPUShaderStage.FRAGMENT
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
      // The history's moment (`historyTargets.ts`).
      { binding: 11, visibility, texture: { sampleType: 'unfilterable-float' } },
      // The trace's records of its texels' pixels (`sampleWgsl.ts`).
      { binding: 12, visibility, texture: { sampleType: 'uint' } },
    ],
  })
}
