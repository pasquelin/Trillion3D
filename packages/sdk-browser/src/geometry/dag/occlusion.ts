import { computeTextureEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { HIZ_FORMAT, HIZ_LEVELS } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { OCCLUSION_BINDING } from './shader/occlusionWgsl.ts'

/** The pyramid a cut tests against: the view of its texture and its levels uniform. */
export type CutPyramid = { readonly view: GPUTextureView; readonly levels: GPUBuffer }

/**
 * THE PYRAMID THE CUT'S OCCLUSION READS, its group 1 (`shader/occlusionWgsl.ts`): the frame's Hi-Z —
 * its texture's view, which changes identity at every target resize, and a levels uniform: the one
 * the previous image built it with in the main pass, the Hi-Z's own in the post pass
 * (`../../frame/render/cutPyramid.ts`) —, or, before any pyramid is made, a texel and a levels
 * uniform of no level, which hides nothing. A group is held for each levels uniform, made again
 * only when the view it binds with it changes: the two passes of an image alternate none.
 */
export function createCutOcclusion(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D cut occlusion',
    entries: [
      computeTextureEntry(OCCLUSION_BINDING.pyramid, 'uint', '2d-array'),
      computeUniformEntry(OCCLUSION_BINDING.levels),
    ],
  })
  const none = device.createTexture({
    label: 'Trillion3D cut occlusion, no pyramid',
    size: { width: 1, height: 1, depthOrArrayLayers: 3 },
    format: HIZ_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  // A zeroed levels uniform counts no level: every footprint lies past the pyramid's last.
  const noLevels = device.createBuffer({
    label: 'Trillion3D cut occlusion, no levels',
    size: HIZ_LEVELS.words * 4,
    usage: GPUBufferUsage.UNIFORM,
  })
  const blank: CutPyramid = { view: none.createView({ dimension: '2d-array' }), levels: noLevels }
  const groups = new WeakMap<GPUBuffer, { view: GPUTextureView; group: GPUBindGroup }>()
  return {
    /** The group-1 layout of the stages that read the pyramid (`../stages.ts`). */
    layout,
    /** The group the cut's dispatch binds: `pyramid`'s, or the blank one. */
    group(pyramid: CutPyramid | undefined) {
      const next = pyramid ?? blank,
        held = groups.get(next.levels)
      if (held?.view === next.view) return held.group
      const group = makeGroup(device, layout, next)
      groups.set(next.levels, { view: next.view, group })
      return group
    },
    dispose() {
      none.destroy()
      noLevels.destroy()
    },
  }
}

export type CutOcclusion = ReturnType<typeof createCutOcclusion>

function makeGroup(device: GPUDevice, layout: GPUBindGroupLayout, pyramid: CutPyramid) {
  return device.createBindGroup({
    layout,
    entries: [
      { binding: OCCLUSION_BINDING.pyramid, resource: pyramid.view },
      { binding: OCCLUSION_BINDING.levels, resource: { buffer: pyramid.levels } },
    ],
  })
}
