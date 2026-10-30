import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import {
  COMPUTE,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
  computeBufferEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { sizedBuffer } from '../../../gpu/core/sizedBuffer.ts'
import { resized } from '../../../../../math/src/sequence/resized.ts'
import { preparedPipeline } from '../../deferred/fullscreen.ts'
import {
  hizLevelZeroBindEntries,
  hizLevelZeroEntries,
} from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../../visibility/hiz/gpu/types.ts'
import { capsuleDepthTerms } from '../../capsuleShadows/plan.ts'
import { VSM_SUN_MASK_FORMAT } from '../vsm/projection/maskFormat.ts'
import {
  OBJECT_SHADOW_PARAM_FLOATS,
  OBJECT_SHADOW_PROJECT_BINDINGS as B,
  OBJECT_SHADOW_SUBJECT_FLOATS,
  objectShadowLocalShader,
  objectShadowSunShader,
} from './objectShadowProjectWgsl.ts'
import type { ObjectShadowSubject } from './objectShadowSubjects.ts'
import type { TranslucentShadowAtlas } from './objectShadowAtlas.ts'
import { writeShadowTile, type TranslucentShadowSlot } from './transmissionAtlas.ts'

/**
 * THE PROJECTION PASSES OF THE TRANSLUCENT OBJECT SHADOWS (`objectShadowProjectWgsl.ts`): the subjects of a frame are grouped once by light and atlas and written into a storage
 * buffer in that order; a light's draw for an atlas names its range in the buffer. The projector, its records and its ranges belong to the view's kit and are refilled each image. A local light's draw is a triangle over its
 * rectangle of the per-light mask, blended by the minimum; a sun's is a compute pass over its layer of the suns' mask. A draw takes its own slot of
 * the uniform buffer (one dynamic offset a draw), so the draws of one encoder do not overwrite each other.
 */

const FRAGMENT = 2
const SLOT_BYTES = 256
const MIN_BLEND: GPUBlendState = {
  color: { operation: 'min', srcFactor: 'one', dstFactor: 'one' },
  alpha: { operation: 'min', srcFactor: 'one', dstFactor: 'one' },
}

const programs = oncePerDevice((device) => {
  const entries = (stage: number, sun: boolean): GPUBindGroupLayoutEntry[] => [
    computeUniformEntry(B.params, { hasDynamicOffset: true }, stage),
    computeBufferEntry(B.subjects, 'read-only-storage', stage),
    computeTextureEntry(B.coefficients0, 'float', '2d', stage),
    computeTextureEntry(B.coefficients1, 'float', '2d', stage),
    computeSamplerEntry(B.sampler, 'filtering', stage),
    ...hizLevelZeroEntries(B.depth, stage),
    ...(sun
      ? [computeStorageTextureEntry(B.sunMask, VSM_SUN_MASK_FORMAT, 'read-write', '2d-array')]
      : []),
  ]
  const localLayout = device.createBindGroupLayout({
    label: 'Trillion3D translucent object shadow local',
    entries: entries(FRAGMENT, false),
  })
  const sunLayout = device.createBindGroupLayout({
    label: 'Trillion3D translucent object shadow sun',
    entries: entries(COMPUTE, true),
  })
  const module = device.createShaderModule({
    label: 'Trillion3D translucent object shadow local',
    code: objectShadowLocalShader(),
  })
  const locals = new Map<GPUTextureFormat, ReturnType<typeof preparedPipeline>>()
  const local = (format: GPUTextureFormat) => {
    let pipeline = locals.get(format)
    if (!pipeline)
      locals.set(
        format,
        (pipeline = preparedPipeline(device, {
          label: 'Trillion3D translucent object shadow local',
          layout: device.createPipelineLayout({ bindGroupLayouts: [localLayout] }),
          vertex: { module, entryPoint: 'objectShadowVertex' },
          fragment: {
            module,
            entryPoint: 'objectShadowFragment',
            targets: [{ format, blend: MIN_BLEND }],
          },
          primitive: { topology: 'triangle-list' },
        })),
      )
    return pipeline
  }
  const sun = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [sunLayout] }),
    device.createShaderModule({
      label: 'Trillion3D translucent object shadow sun',
      code: objectShadowSunShader(),
    }),
    'objectShadowSun',
    undefined,
    'Trillion3D translucent object shadow sun',
  )
  return {
    local,
    sun,
    localLayout,
    sunLayout,
    sampler: device.createSampler({
      label: 'Trillion3D translucent object shadow',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    }),
  }
})

/** The image the projection reads: the camera and the size drawn. */
export interface ProjectionImage {
  readonly view: readonly [number, number]
  readonly projection: ArrayLike<number>
  readonly world: ArrayLike<number>
  readonly perspective: boolean
  readonly near: number
  readonly far: number
}

/** The range of a light's subjects in one atlas, in the subjects buffer, and the slot of the uniform buffer its draw reads. */
export interface ProjectionRange {
  /** The id of the light the range belongs to (`VsmProjectionLight.mapId`). */
  light: number
  atlas: number
  first: number
  count: number
  /** The slot of the draw's uniform: its place among the frame's ranges. */
  slot: number
}

/** What a view holds of its projection: the buffers, and the bind groups of its draws. */
export interface ObjectShadowProjector {
  readonly lights: ReadonlyMap<number, readonly ProjectionRange[]>
  /** A local light's subjects into `layer`, of the given `format`, over `rect` (the first column and row, one past the last). False where nothing was drawn. */
  local(
    encoder: GPUCommandEncoder,
    mapId: number,
    layer: GPUTextureView,
    rect: readonly [number, number, number, number],
    format: GPUTextureFormat,
  ): boolean
  /** A sun's subjects into the layer it was given in the inputs (`suns`) of the suns' mask. False where nothing was drawn. */
  sun(encoder: GPUCommandEncoder, mapId: number, sunMask: GPUTextureView): boolean
}

/** The state the projector writes before its draws. */
interface ProjectorInputs {
  /** What the view's buffers and groups are held under (`viewKey`). */
  readonly key: object
  readonly device: GPUDevice
  readonly image: ProjectionImage
  readonly depth: HizDepth
  readonly atlases: readonly TranslucentShadowAtlas[]
  /** The subjects of the frame and the slot each was given (`slots[k]` for `subjects[k]`, none where it fits no atlas). */
  readonly subjects: readonly ObjectShadowSubject[]
  readonly slots: readonly (TranslucentShadowSlot | null)[]
  /** The suns by their light's id: the rank of each is the layer of the suns' mask it is read into. */
  readonly suns: ReadonlyMap<number, { readonly rank: number }>
  /** The camera's position in centimetres. */
  readonly eye: ArrayLike<number>
  readonly atlasSide: number
}

const f32 = (out: Float32Array, at: number, source: ArrayLike<number>, count: number) => {
  for (let i = 0; i < count; i++) out[at + i] = source[i]!
}

/** Writes the record of a subject placed in `slot` (`OBJECT_SHADOW_SUBJECT_FLOATS` floats) at `at`. */
export function writeSubject(
  out: Float32Array,
  at: number,
  subject: ObjectShadowSubject,
  slot: TranslucentShadowSlot,
  eye: ArrayLike<number>,
  side: number,
) {
  const p = subject.projection
  f32(out, at, p.translatedWorldToClipInner, 16)
  out[at + 16] = eye[0]! + p.preShadowTranslation[0]
  out[at + 17] = eye[1]! + p.preShadowTranslation[1]
  out[at + 18] = eye[2]! + p.preShadowTranslation[2]
  writeShadowTile(out, at + 20, at + 28, p, slot, side)
  out[at + 24] = p.invMaxSubjectDepth
  out[at + 25] = subject.fade
  out[at + 26] = p.fadeStart
  out[at + 27] = p.invFadeLength
}

/**
 * Writes the uniform of a draw (`OBJECT_SHADOW_PARAM_FLOATS` floats) at `at`. The words the program does not read (the camera matrix's position, the viewport's
 * corner, the depth terms' fourth) are not written: zero in a buffer this alone fills, the 1 of the matrix's corner excepted.
 */
export function writeParams(
  out: Float32Array,
  at: number,
  image: ProjectionImage,
  range: Pick<ProjectionRange, 'first' | 'count'>,
  layer: number,
  clipToView: ArrayLike<number>,
) {
  f32(out, at, clipToView, 16)
  // Only the camera's axes: the eye is added in centimetres by the subjects' offsets.
  f32(out, at + 16, image.world, 12)
  out[at + 31] = 1
  out[at + 34] = image.view[0]
  out[at + 35] = image.view[1]
  const terms = capsuleDepthTerms(image)
  out[at + 36] = terms[0]
  out[at + 37] = terms[1]
  out[at + 38] = terms[2]
  out[at + 40] = range.first
  out[at + 41] = range.count
  out[at + 42] = layer
  out[at + 43] = image.perspective ? 1 : 0
}

/** What a view holds across its images: the subjects' buffer and its words, the draws' uniform buffer and its words, the bind groups (made again only where a resource they name moved), the order and ranges of the image, and the projector itself. */
interface ProjectorKit {
  readonly device: GPUDevice
  subjects: GPUBuffer | undefined
  words: Float32Array<ArrayBuffer>
  /** The draws' uniform buffer, grown to the frame's ranges (a slot a range), and its words. */
  params: GPUBuffer | undefined
  paramFloats: Float32Array<ArrayBuffer>
  readonly clipToView: Float64Array
  readonly groups: Map<string, { resources: readonly unknown[]; group: GPUBindGroup }>
  /** The subjects that were given a slot, ordered by light then atlas; the rank each light has among them; the ranges by light and the arrays and records they are made of. */
  readonly order: number[]
  readonly lightRanks: Map<number, number>
  readonly lights: Map<number, ProjectionRange[]>
  readonly lists: ProjectionRange[][]
  readonly ranges: ProjectionRange[]
  /** The inputs of the image being drawn. */
  inputs: ProjectorInputs | undefined
  projector: ObjectShadowProjector
}
const kits = new WeakMap<object, ProjectorKit>()

/** Lets go of a view's projection buffers (retired: the encoders still open may name them). */
export function releaseObjectShadowProjector(key: object) {
  const kit = kits.get(key)
  if (!kit) return
  if (kit.subjects) retire(kit.device, kit.subjects)
  if (kit.params) retire(kit.device, kit.params)
  kits.delete(key)
}

/** The bind group of a draw kind for an atlas, kept while every resource it names stands. */
function groupOf(
  kit: ProjectorKit,
  kind: string,
  layout: GPUBindGroupLayout,
  index: number,
  extra: GPUBindGroupEntry[],
) {
  const { device, atlases, depth } = kit.inputs!
  const atlas = atlases[index]!
  const resources = [kit.subjects, kit.params, atlas, depth, ...extra.map((e) => e.resource)]
  const held = kit.groups.get(`${kind}:${index}`)
  if (held && held.resources.every((r, i) => r === resources[i])) return held.group
  const made = device.createBindGroup({
    label: 'Trillion3D translucent object shadow',
    layout,
    entries: [
      {
        binding: B.params,
        resource: { buffer: kit.params!, size: OBJECT_SHADOW_PARAM_FLOATS * 4 },
      },
      { binding: B.subjects, resource: { buffer: kit.subjects! } },
      { binding: B.coefficients0, resource: atlas.views[0]! },
      { binding: B.coefficients1, resource: atlas.views[1]! },
      { binding: B.sampler, resource: programs(device).sampler },
      ...hizLevelZeroBindEntries(B.depth, depth),
      ...extra,
    ],
  })
  kit.groups.set(`${kind}:${index}`, { resources, group: made })
  return made
}

/** The projector of a kit: its draws read the ranges and the uniform slots `createObjectShadowProjector` made for the image. */
function projectorOf(kit: ProjectorKit): ObjectShadowProjector {
  return {
    lights: kit.lights,
    local(encoder, mapId, layer, rect, format) {
      const { image, device } = kit.inputs!
      const p = programs(device)
      const ranges = kit.lights.get(mapId)
      const pipeline = p.local(format).get()
      if (!ranges?.length || !pipeline) return false
      let drawn = false
      for (const range of ranges) {
        const pass = encoder.beginRenderPass({
          label: 'Trillion3D translucent object shadow local',
          colorAttachments: [{ view: layer, loadOp: 'load', storeOp: 'store' }],
        })
        pass.setViewport(0, 0, image.view[0], image.view[1], 0, 1)
        pass.setScissorRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, groupOf(kit, 'local', p.localLayout, range.atlas, []), [
          range.slot * SLOT_BYTES,
        ])
        pass.draw(3)
        pass.end()
        drawn = true
      }
      return drawn
    },
    sun(encoder, mapId, sunMask) {
      const { image, device } = kit.inputs!
      const p = programs(device)
      const ranges = kit.lights.get(mapId)
      const pipeline = p.sun.get()
      if (!ranges?.length || !pipeline) return false
      let drawn = false
      for (const range of ranges) {
        const pass = encoder.beginComputePass({ label: 'Trillion3D translucent object shadow sun' })
        pass.setPipeline(pipeline)
        pass.setBindGroup(
          0,
          groupOf(kit, 'sun', p.sunLayout, range.atlas, [
            { binding: B.sunMask, resource: sunMask },
          ]),
          [range.slot * SLOT_BYTES],
        )
        pass.dispatchWorkgroups(ceilDiv(image.view[0], 8), ceilDiv(image.view[1], 8))
        pass.end()
        drawn = true
      }
      return drawn
    },
  }
}

function kitOf(key: object, device: GPUDevice): ProjectorKit {
  let kit = kits.get(key)
  if (kit?.device !== device) {
    releaseObjectShadowProjector(key)
    kit = {
      device,
      subjects: undefined,
      words: new Float32Array(OBJECT_SHADOW_SUBJECT_FLOATS),
      params: undefined,
      paramFloats: new Float32Array(SLOT_BYTES / 4),
      clipToView: new Float64Array(16),
      groups: new Map(),
      order: [],
      lightRanks: new Map(),
      lights: new Map(),
      lists: [],
      ranges: [],
      inputs: undefined,
      projector: undefined as never,
    }
    kit.projector = projectorOf(kit)
    kits.set(key, kit)
  }
  return kit
}

/** The rank of a subject's light among the placed ones and its atlas, as one number: the order the records are written in. */
const orderKey = (kit: ProjectorKit, inputs: ProjectorInputs, k: number) =>
  kit.lightRanks.get(inputs.subjects[k]!.lightId)! * inputs.atlases.length + inputs.slots[k]!.atlas

/**
 * The projector of a frame: the subjects that were given a slot grouped once by light and atlas, their records uploaded into the view's held buffer, the
 * draws' uniforms (one a light and atlas) uploaded in one write, ready to draw.
 */
export function createObjectShadowProjector(inputs: ProjectorInputs): ObjectShadowProjector {
  const { key, device, image, subjects, slots, atlasSide, eye, suns } = inputs
  const kit = kitOf(key, device)
  kit.inputs = inputs
  const { order, lightRanks, lights, lists, ranges } = kit
  order.length = 0
  lightRanks.clear()
  lights.clear()
  for (let k = 0; k < subjects.length; k++) {
    if (!slots[k]) continue
    if (!lightRanks.has(subjects[k]!.lightId)) lightRanks.set(subjects[k]!.lightId, lightRanks.size)
    order.push(k)
  }
  order.sort((a, b) => orderKey(kit, inputs, a) - orderKey(kit, inputs, b) || a - b)
  kit.words = resized(kit.words, Math.max(1, order.length) * OBJECT_SHADOW_SUBJECT_FLOATS)
  invertMatrix4(kit.clipToView, image.projection)
  let rangesUsed = 0
  let listsUsed = 0
  let list: ProjectionRange[] | undefined
  let range: ProjectionRange | undefined
  let lightId = -1
  order.forEach((k, at) => {
    const subject = subjects[k]!
    const slot = slots[k]!
    writeSubject(kit.words, at * OBJECT_SHADOW_SUBJECT_FLOATS, subject, slot, eye, atlasSide)
    if (!list || subject.lightId !== lightId) {
      lightId = subject.lightId
      if (listsUsed === lists.length) lists.push([])
      list = lists[listsUsed++]!
      list.length = 0
      lights.set(lightId, list)
      range = undefined
    }
    if (range?.atlas !== slot.atlas) {
      if (rangesUsed === ranges.length)
        ranges.push({ light: 0, atlas: 0, first: 0, count: 0, slot: -1 })
      range = ranges[rangesUsed++]!
      range.light = lightId
      range.atlas = slot.atlas
      range.first = at
      range.count = 0
      range.slot = rangesUsed - 1
      list.push(range)
    }
    range!.count++
  })
  kit.subjects = sizedBuffer(
    device,
    kit.subjects,
    kit.words.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    'Trillion3D translucent object shadow subjects',
  )
  device.queue.writeBuffer(
    kit.subjects,
    0,
    kit.words,
    0,
    order.length * OBJECT_SHADOW_SUBJECT_FLOATS,
  )
  // One uniform a light and atlas, all uploaded at once.
  const slotFloats = SLOT_BYTES / 4
  const used = rangesUsed
  kit.paramFloats = resized(kit.paramFloats, Math.max(1, used) * slotFloats)
  kit.params = sizedBuffer(
    device,
    kit.params,
    kit.paramFloats.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    'Trillion3D translucent object shadow params',
  )
  for (let r = 0; r < used; r++) {
    const held = ranges[r]!
    writeParams(
      kit.paramFloats,
      r * slotFloats,
      image,
      held,
      suns.get(held.light)?.rank ?? 0,
      kit.clipToView,
    )
  }
  if (used)
    device.queue.writeBuffer(
      kit.params,
      0,
      kit.paramFloats,
      0,
      (used - 1) * slotFloats + OBJECT_SHADOW_PARAM_FLOATS,
    )
  return kit.projector
}
