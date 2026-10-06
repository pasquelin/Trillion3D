import { RECEIVER_BINDINGS } from '../../visibility/shader/receiverOffsetWgsl.ts'
import { SHADE_UNIFORM_BYTES } from '../../visibility/shader/request.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/types.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { bindingLayout, bindingResource, type ComputeBinding } from '../shadow/computePass.ts'
import { createFloatAtlas } from '../core/floatAtlas.ts'

/** What the receiver offset reads (`receiverOffsetWgsl.ts`), in `RECEIVER_BINDINGS` order: the
 *  visibility buffer, the resolve's uniform, the page table, the page cache, the float pool's
 *  positions and its normal atlas (`../core/floatAtlas.ts`). */
export type ReceiverResources = [
  vis: GPUTextureView,
  uniform: GPUBuffer,
  pages: GPUBuffer,
  indices: GPUBuffer,
  positions: GPUBuffer,
  normals: GPUTextureView,
]

/** How each receiver binding is declared: the visibility buffer's words, the uniform, three
 *  read-only buffers, then the normals' float atlas. */
const RECEIVER_BINDING_TYPES: readonly ComputeBinding[] = RECEIVER_BINDINGS.map((name) =>
  name === 'vis'
    ? { texture: 'uint' }
    : name === 'normals'
      ? { texture: 'unfilterable-float', dimension: '2d-array' }
      : name === 'uniform'
        ? 'uniform'
        : 'read-only-storage',
)

/** The receiver bindings of a layout, from `first` on. */
export const receiverLayoutEntries = (
  first: number,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] =>
  RECEIVER_BINDING_TYPES.map((type, i) => ({
    binding: first + i,
    visibility,
    ...bindingLayout(type),
  }))

/** The receiver entries of a bind group, from `first` on. */
export const receiverEntries = (first: number, resources: ReceiverResources): GPUBindGroupEntry[] =>
  resources.map((resource, i) => ({
    binding: first + i,
    resource: bindingResource(RECEIVER_BINDING_TYPES[i], resource),
  }))

const held: (GPUTextureView | GPUBuffer)[] = []

/**
 * The frame's own receiver resources — the very ones the resolve bound (`shadeBindings.ts`), never
 * a copy —, or nothing while one of them does not exist: then no pixel was resolved, and none is
 * lit. The array is reused from one image to the next: nothing is allocated.
 */
export function receiverResources({ vis, gpu }: WebgpuPagesRuntime) {
  const { visView, shadeUniform, pageTable, concatPos, concatNrm } = vis,
    indices = gpu.cache?.buffer
  if (!visView || !shadeUniform || !pageTable || !indices || !concatPos || !concatNrm)
    return undefined
  held[0] = visView
  held[1] = shadeUniform
  held[2] = pageTable
  held[3] = indices
  held[4] = concatPos
  held[5] = concatNrm
  return held as unknown as ReceiverResources
}

/**
 * Stand-ins a lit program binds before the visibility buffer exists: one word of background, a
 * resolve uniform, one page's bytes and a row of normals, which no pixel reads — every surface
 * flag is then zero.
 */
export function receiverPlaceholders(device: GPUDevice) {
  const vis = device.createTexture({
    label: 'Trillion3D empty visibility',
    size: [1, 1],
    format: 'r32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D empty resolve uniform',
    size: SHADE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM,
  })
  const page = device.createBuffer({
    label: 'Trillion3D empty page',
    size: PAGE_INFO_STRIDE,
    usage: GPUBufferUsage.STORAGE,
  })
  const normals = createFloatAtlas(device, 'Trillion3D empty normals', 1)
  const resources: ReceiverResources = [vis.createView(), uniform, page, page, page, normals.view]
  return {
    resources,
    normals: normals.view,
    dispose() {
      normals.texture.destroy()
      vis.destroy()
      uniform.destroy()
      page.destroy()
    },
  }
}
