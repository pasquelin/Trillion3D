/**
 * Bindings of the bounce compute passes, described by their type alone.
 *
 * Both passes — surface cache and probes — read the same proxy columns at the same slots:
 * one way to describe a binding keeps the two shaders and the two groups from drifting
 * apart. An unused slot is not declared at all: a pass that no longer needs lights does
 * not bind them.
 */

/** Layout of a pass: one type per slot, `null` for a slot the pass does not use. */
export function bounceLayout(device: GPUDevice, types: (GPUBufferBindingType | null)[]) {
  return device.createBindGroupLayout({
    entries: types.flatMap((type, binding) =>
      type ? [{ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } }] : [],
    ),
  });
}

/** Matching group: one buffer per declared slot, in the same order. */
export function bounceGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  buffers: (GPUBuffer | null)[],
) {
  return device.createBindGroup({
    layout,
    entries: buffers.flatMap((buffer, binding) =>
      buffer ? [{ binding, resource: { buffer } }] : [],
    ),
  });
}
