import { writeReprojection } from '../taa/view.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { REFLECTION_SOURCE_VIEW_BYTES, reflectionSourceLayout } from './sourceWgsl.ts'
import { REFLECTION_PLACEMENT_VERSIONS, type ReflectionHistoryFrame } from './historyFrame.ts'
import { sameValues } from '../math/matrixElements.ts'
import { reflectionTargets } from './historyTargets.ts'

/** The last unfogged image (8 bytes), and the last depth and identifiers (4 each) the history
 *  resolve reads too; the reprojected source itself (8) is `gpu.ts`'s. */
export const REFLECTION_SOURCE_BYTES_PER_PIXEL = 16

/** What the reprojection reads beside the depth, the image's frame (`reflectionFrame.ts`): this
 *  image's identifiers, the page table and the placement motion, live only while the temporal pass
 *  writes it (the page table otherwise, bound and never read); `eye`, the render origin that motion
 *  is written at; `metadata`, the depth and identifier textures kept for the next image; `epoch`,
 *  the placement epoch: moved without live motion, a point is checked by its triangle. */
export type ReflectionSourceInputs = Pick<
  ReflectionHistoryFrame,
  'ids' | 'pages' | 'motion' | 'eye' | 'epoch'
> & { metadata: Pick<ReflectionHistoryFrame['metadata'], 'depth' | 'ids'> }

/** The reprojection of the last lit image over targets of `width × height`: the unfogged image the
 *  lighting writes (`target`), the depth and identifiers it was drawn with (`previous`, copied by
 *  `keep`), its uniform and bind group. */
export function createReflectionSource(
  device: GPUDevice,
  width: number,
  height: number,
  depth: GPUTextureView,
) {
  const { textures, target } = reflectionTargets(device, width, height)
  let uniform: GPUBuffer | undefined
  try {
    const image = target('last unfogged image', 'rgba16float')
    const lastDepth = target('last depth', 'depth32float', true)
    const lastIds = target('last visibility', 'r32uint', true)
    uniform = device.createBuffer({
      label: 'Trillion3D reflection source view',
      size: REFLECTION_SOURCE_VIEW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const heldUniform = uniform
    const imageView = image.view
    const previous = { depth: lastDepth.view, ids: lastIds.view }
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    const packed = new Float32Array(REFLECTION_SOURCE_VIEW_BYTES / 4),
      last = new Float64Array(16),
      lastDrawn = [0, 0],
      placement = new Float64Array(REFLECTION_PLACEMENT_VERSIONS)
    const identity = createWebgpuBindIdentity()
    let kept = false,
      placed = false,
      current: ReflectionSourceInputs | undefined,
      group: GPUBindGroup | undefined
    return {
      /** The last depth and identifiers, read by the history resolve too (`historyTargets.ts`). */
      previous,
      /** The bind group of the last `update`, none unless it was given inputs. */
      get group() {
        return group
      },
      /** The target the lighting writes this image's unfogged, mirror-free colour into. */
      target: imageView,
      /** This image's view and drawn size; each call is one image, the next one's source. */
      update(matrix: ArrayLike<number>, drawn: readonly number[], inputs?: ReflectionSourceInputs) {
        current = inputs
        if (inputs) {
          const next = identity.next
          next[0] = inputs.ids
          next[1] = inputs.pages
          next[2] = inputs.motion
          if (identity.moved() || !group)
            group = device.createBindGroup({
              layout: reflectionSourceLayout(device),
              entries: [
                imageView,
                sampler,
                depth,
                inputs.ids,
                { buffer: heldUniform },
                { buffer: inputs.pages },
                { buffer: inputs.motion },
                previous.depth,
                previous.ids,
              ].map((resource, binding) => ({ binding, resource })),
            })
          const live = inputs.motion !== inputs.pages
          writeReprojection(packed, last, matrix, inputs.eye, drawn)
          packed[36] = kept ? 1 : 0
          packed[37] = !live && placed && !sameValues(placement, inputs.epoch) ? 1 : 0
          packed[38] = live ? 1 : 0
          packed[40] = lastDrawn[0]
          packed[41] = lastDrawn[1]
          packed[42] = 1 / width
          packed[43] = 1 / height
          device.queue.writeBuffer(heldUniform, 0, packed)
          placement.set(inputs.epoch)
          placed = true
          // Without inputs no source is drawn (`encode.ts`): nothing reads the uniform.
        } else group = undefined
        last.set(matrix)
        lastDrawn[0] = drawn[0]
        lastDrawn[1] = drawn[1]
        kept = false
      },
      /** After every reader of `previous` this image: this image's depth and identifiers become
       *  the next one's, which reads its source from here on. */
      keep(encoder: GPUCommandEncoder) {
        if (!current) return
        const size = { width, height, depthOrArrayLayers: 1 }
        encoder.copyTextureToTexture(
          { texture: current.metadata.depth, aspect: 'depth-only' },
          { texture: lastDepth.texture, aspect: 'depth-only' },
          size,
        )
        encoder.copyTextureToTexture(
          { texture: current.metadata.ids },
          { texture: lastIds.texture },
          size,
        )
        kept = true
      },
      dispose() {
        for (const made of textures) made.destroy()
        heldUniform.destroy()
      },
    }
  } catch (error) {
    for (const made of textures) made.destroy()
    uniform?.destroy()
    throw error
  }
}
export type ReflectionSource = ReturnType<typeof createReflectionSource>
