import { hizDepthBindEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'
import { AO_BINDINGS } from './layout.ts'
import { aoExtentOf } from './plan.ts'
import type { AoImage } from './params.ts'
import type { AoView, AoViewSpec } from './view.ts'

/** What an image needs of the frame to draw the occlusion: the device, the surfaces' normals, the depth pyramid the image
 *  drew, the lighting's stand-in for a texture no pass reads, and the vectors of motion the velocity stage measured this
 *  image, where it did. One object the frame refills (`neededOf`). */
export interface AoNeeded {
  device: GPUDevice
  normals: GPUTextureView
  depth: HizDepth
  empty: GPUTextureView
  vectors: GPUTextureView | undefined
}

/**
 * A METHOD OF THE OCCLUSION, made for a set of settings (`discMethod`, `horizonMethod`): what it asks of a view at a size
 * (`spec`, kept while the size and `accumulates` — whether the image accumulates in time — hold, so that a frame builds
 * none), whether its programs are compiled (`ready`, asked off the frame), and its passes drawn into a view made to its
 * spec (`draw`), which returns the texture the lighting reads. `extent` is the size of the textures the last `spec` was made at.
 */
export interface AoMethod {
  spec(allocated: readonly [number, number], accumulates: boolean): AoViewSpec
  readonly extent: readonly [number, number]
  ready(device: GPUDevice): boolean
  draw(encoder: GPUCommandEncoder, view: AoView, needed: AoNeeded, image: AoImage): GPUTextureView
}

/** The spec a method makes (`build`, at the textures' extent, for an image that accumulates in time or not) kept while the
 *  render targets' size and the flag hold, and the extent. */
export function specCache(
  build: (extent: readonly [number, number], accumulates: boolean) => AoViewSpec,
) {
  let width = -1,
    height = -1,
    flag = false
  let held: AoViewSpec | undefined
  let extent: readonly [number, number] = [0, 0]
  return {
    spec(allocated: readonly [number, number], accumulates: boolean) {
      if (held && allocated[0] === width && allocated[1] === height && accumulates === flag)
        return held
      width = allocated[0]
      height = allocated[1]
      flag = accumulates
      extent = aoExtentOf(allocated)
      return (held = build(extent, accumulates))
    },
    get extent() {
      return extent
    },
  }
}

/** The entries every pass's group opens with, whichever method's: the pass's uniform, the depth pyramid and — for a pass that reads
 *  them — the surfaces' normals, at the bindings both methods share (`AO_BINDINGS`). */
export const aoCommonEntries = (
  params: GPUBuffer,
  needed: AoNeeded,
  withNormals = true,
): GPUBindGroupEntry[] => [
  { binding: AO_BINDINGS.params, resource: { buffer: params } },
  ...hizDepthBindEntries(AO_BINDINGS.depth, needed.depth),
  ...(withNormals ? [{ binding: AO_BINDINGS.normals, resource: needed.normals }] : []),
]
