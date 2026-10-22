import type { Size } from '../clouds/reconstructLayout.ts'

/** The slot of a draw's uniform in the buffer the targets hold (`LightShaftTargets.slot`). */
export interface LightShaftSlot {
  readonly slot: number
  readonly buffer: GPUBuffer
  readonly offset: number
}

/** One binding of a draw's group besides its uniform. */
export interface LightShaftBinding {
  readonly binding: number
  readonly resource: GPUBindingResource
}

/**
 * The draws of the light shafts: a full-screen triangle over the first `written` pixels of one
 * colour target, its one group bound at 0, the target cleared to white or loaded. The descriptor
 * every pass begins with is rewritten in place, and the group of a slot is kept while the layout,
 * the buffer and the resources it names are the same ones (the chains of a still scene bind the
 * same images every image), so that an image allocates no group it did not allocate before.
 */
export function createLightShaftDraw(device: GPUDevice) {
  const attachment = {
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: { r: 1, g: 1, b: 1, a: 1 },
  } as GPURenderPassColorAttachment
  const descriptor: GPURenderPassDescriptor = {
    label: 'Trillion3D light shafts',
    colorAttachments: [attachment],
  }
  const held: {
    layout: GPUBindGroupLayout
    buffer: GPUBuffer
    names: unknown[]
    group: GPUBindGroup
  }[] = []
  /** The group of `slot` for `layout`, naming the uniform of `bytes` bytes and `bindings`. */
  const groupOf = (
    slot: LightShaftSlot,
    layout: GPUBindGroupLayout,
    bytes: number,
    bindings: readonly LightShaftBinding[],
  ) => {
    const kept = held[slot.slot]
    if (
      kept?.layout === layout &&
      kept.buffer === slot.buffer &&
      kept.names.length === bindings.length &&
      bindings.every((b, at) => kept.names[at] === b.resource)
    )
      return kept.group
    const group = device.createBindGroup({
      label: 'Trillion3D light shafts',
      layout,
      entries: [
        { binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: bytes } },
        ...bindings,
      ],
    })
    held[slot.slot] = { layout, buffer: slot.buffer, names: bindings.map((b) => b.resource), group }
    return group
  }
  return {
    groupOf,
    /** Draws `pipeline` with `group` over the first `written` pixels of `target`. */
    draw(
      encoder: GPUCommandEncoder,
      pipeline: GPURenderPipeline,
      group: GPUBindGroup,
      target: GPUTextureView,
      written: Size,
      load: boolean,
    ) {
      attachment.view = target
      attachment.loadOp = load ? 'load' : 'clear'
      const pass = encoder.beginRenderPass(descriptor)
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      pass.setViewport(0, 0, written.width, written.height, 0, 1)
      pass.draw(3)
      pass.end()
    },
  }
}

export type LightShaftDraw = ReturnType<typeof createLightShaftDraw>
