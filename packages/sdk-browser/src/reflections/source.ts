import { writeReprojection } from '../taa/view.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { REFLECTION_SOURCE_VIEW_BYTES, reflectionSourceLayout } from './sourceWgsl.ts'
import { REFLECTION_PLACEMENT_VERSIONS, type ReflectionHistoryFrame } from './historyFrame.ts'
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'
import { reflectionTargets } from './historyTargets.ts'

/** The last unfogged image (8 bytes), and the last depth and identifiers (4 each) the history
 *  resolve reads too; the reprojected source itself (8) is `gpu.ts`'s. */
export const REFLECTION_SOURCE_BYTES_PER_PIXEL = 16

/** What the reprojection reads beside the depth, the image's frame (`reflectionFrame.ts`): this
 *  image's identifiers, the page table and the placement motion, live only while the temporal pass
 *  writes it (the page table otherwise, bound and never read); `eye`, the render origin that motion
 *  is written at; `metadata`, the depth and identifier textures kept for the next image; `epoch`,
 *  the placement epoch: moved without live motion, a point is checked by its triangle. */
type ReflectionSourceInputs = Pick<
  ReflectionHistoryFrame,
  'ids' | 'pages' | 'motion' | 'eye' | 'epoch'
> & { metadata: Pick<ReflectionHistoryFrame['metadata'], 'depth' | 'ids'> }

type ReflectionTarget = ReturnType<ReturnType<typeof reflectionTargets>['target']>

/** What the reprojection keeps between its calls: what it is made of, the words of its view, the
 *  last image's matrix, drawn size and placement epochs, its group's identity, whether the last
 *  depth and identifiers were kept and the placement read, the image's inputs and its group. */
type SourceState = {
  device: GPUDevice
  width: number
  height: number
  depth: GPUTextureView
  uniform: GPUBuffer
  image: ReflectionTarget
  lastDepth: ReflectionTarget
  lastIds: ReflectionTarget
  sampler: GPUSampler
  packed: Float32Array<ArrayBuffer>
  last: Float64Array
  lastDrawn: number[]
  placement: Float64Array
  identity: ReturnType<typeof createWebgpuBindIdentity>
  kept: boolean
  placed: boolean
  current?: ReflectionSourceInputs
  group?: GPUBindGroup
}

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
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    return reflectionSource(textures, {
      device,
      width,
      height,
      depth,
      uniform,
      image,
      lastDepth,
      lastIds,
      sampler,
      packed: new Float32Array(REFLECTION_SOURCE_VIEW_BYTES / 4),
      last: new Float64Array(16),
      lastDrawn: [0, 0],
      placement: new Float64Array(REFLECTION_PLACEMENT_VERSIONS),
      identity: createWebgpuBindIdentity(),
      kept: false,
      placed: false,
    })
  } catch (error) {
    for (const made of textures) made.destroy()
    uniform?.destroy()
    throw error
  }
}

/** The reprojection's calls (`createReflectionSource`) on its state; `textures`, its targets. */
function reflectionSource(textures: readonly GPUTexture[], s: SourceState) {
  const { width, height, lastDepth, lastIds } = s
  const previous = { depth: lastDepth.view, ids: lastIds.view }
  return {
    /** The last depth and identifiers, read by the history resolve too (`historyTargets.ts`). */
    previous,
    /** The bind group of the last `update`, none unless it was given inputs. */
    get group() {
      return s.group
    },
    /** The target the lighting writes this image's unfogged, mirror-free colour into. */
    target: s.image.view,
    /** This image's view and drawn size; each call is one image, the next one's source. */
    update(matrix: ArrayLike<number>, drawn: readonly number[], inputs?: ReflectionSourceInputs) {
      s.current = inputs
      if (inputs) readInputs(s, matrix, drawn, inputs)
      // Without inputs no source is drawn (`encode.ts`): nothing reads the uniform.
      else s.group = undefined
      s.last.set(matrix)
      s.lastDrawn[0] = drawn[0]
      s.lastDrawn[1] = drawn[1]
      s.kept = false
    },
    /** After every reader of `previous` this image: this image's depth and identifiers become
     *  the next one's, which reads its source from here on. */
    keep(encoder: GPUCommandEncoder) {
      const { current } = s
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
      s.kept = true
    },
    dispose() {
      for (const made of textures) made.destroy()
      s.uniform.destroy()
    },
  }
}

/** An image's inputs: the group reading them, rebuilt when one is replaced, and the view of its
 *  reprojection from the last image. */
function readInputs(
  s: SourceState,
  matrix: ArrayLike<number>,
  drawn: readonly number[],
  inputs: ReflectionSourceInputs,
) {
  const { device, packed, lastDrawn, placement, identity } = s
  const next = identity.next
  next[0] = inputs.ids
  next[1] = inputs.pages
  next[2] = inputs.motion
  if (identity.moved() || !s.group)
    s.group = device.createBindGroup({
      layout: reflectionSourceLayout(device),
      entries: [
        s.image.view,
        s.sampler,
        s.depth,
        inputs.ids,
        { buffer: s.uniform },
        { buffer: inputs.pages },
        { buffer: inputs.motion },
        s.lastDepth.view,
        s.lastIds.view,
      ].map((resource, binding) => ({ binding, resource })),
    })
  const live = inputs.motion !== inputs.pages
  writeReprojection(packed, s.last, matrix, inputs.eye, drawn)
  packed[36] = s.kept ? 1 : 0
  packed[37] = !live && s.placed && !sameValues(placement, inputs.epoch) ? 1 : 0
  packed[38] = live ? 1 : 0
  packed[40] = lastDrawn[0]
  packed[41] = lastDrawn[1]
  packed[42] = 1 / s.width
  packed[43] = 1 / s.height
  device.queue.writeBuffer(s.uniform, 0, packed)
  placement.set(inputs.epoch)
  s.placed = true
}
export type ReflectionSource = ReturnType<typeof createReflectionSource>
