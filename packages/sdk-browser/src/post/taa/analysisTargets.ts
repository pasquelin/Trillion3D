import { TAA_PASS } from '../../diagnostic/stage/passLabels.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { resolveTargetUsage, taaPass } from './resolve.ts'
import { CLOSEST_FORMAT, MARKS_FORMAT, VECTOR_FORMAT } from './velocityWgsl.ts'
import { REPROJECTED_FORMAT, SHADING_HISTORY_FORMAT, FLICKER_FORMAT } from './reprojectWgsl.ts'
import { THIN_GEOMETRY_FORMAT } from './thinGeometryWgsl.ts'
import { HELD_MEASURE_FORMAT, REJECTION_FORMAT } from './rejectionWgsl.ts'
import {
  ANTI_ALIASING_FORMAT,
  ANTI_ALIAS_NEUTRAL,
  SPATIAL_AA_BINDINGS,
} from './spatialAntiAliasingWgsl.ts'

/** The closest occluders scattered where they stood: a word per render texel, and a second one
 *  under an orthographic projection (`velocityWgsl.ts`), made by the first orthographic image. */
const OCCLUDER_BYTES = 4

/** The render-resolution targets of one image, each named by what it holds between which passes:
 *  the hole-filled vectors (`filled`) are the history's; the flicker error is written over the
 *  closest depth word, which the reprojection last reads (`FLICKER_ERROR_FORMAT`). The vectors the
 *  reprojection starts from are the velocity stage's (`../velocity.ts`), which the motion blur reads
 *  after the pass: none is kept here. */
const TRANSIENT_FORMATS = {
  closest: CLOSEST_FORMAT,
  filled: VECTOR_FORMAT,
  reprojected: REPROJECTED_FORMAT,
  marks: MARKS_FORMAT,
  shadingReprojected: SHADING_HISTORY_FORMAT,
  flickerThenLuma: FLICKER_FORMAT,
  rejection: REJECTION_FORMAT,
  filteredInput: HELD_MEASURE_FORMAT,
  filteredHistory: HELD_MEASURE_FORMAT,
  filteredError: HELD_MEASURE_FORMAT,
} as const
/** The render-resolution histories, one of each: the reprojection reads them into the image's
 *  targets, and a later pass writes each for the next image. */
const RENDER_HISTORY_FORMATS = {
  shading: SHADING_HISTORY_FORMAT,
  flicker: FLICKER_FORMAT,
  thin: THIN_GEOMETRY_FORMAT,
}

const bytesOf = (formats: Record<string, GPUTextureFormat>) =>
  Object.values(formats).reduce((bytes, format) => bytes + texelBytesOf(format), 0)

/** Bytes per render pixel of the analysis: its targets, the anti-aliaser's, the render-resolution
 *  histories and a perspective's occluder word — an orthographic view adds one word more. */
export const ANALYSIS_BYTES_PER_PIXEL =
  bytesOf(TRANSIENT_FORMATS) +
  texelBytesOf(ANTI_ALIASING_FORMAT) +
  bytesOf(RENDER_HISTORY_FORMATS) +
  OCCLUDER_BYTES

/** The analysis's targets at one size: the views its passes name, the occluder words, and the
 *  anti-aliaser's group and passes. */
export type AnalysisTargetViews = Record<keyof typeof TRANSIENT_FORMATS, GPUTextureView> &
  Record<keyof typeof RENDER_HISTORY_FORMATS, GPUTextureView> & {
    antiAliasing: GPUTextureView
    occluders: GPUBuffer
    /** The occluder words a render texel has: one, two once an orthographic image was drawn. */
    occluderSlices: number
    aaGroup: GPUBindGroup
    aaPass: GPURenderPassDescriptor
    /** The anti-aliaser's target cleared to no offset and no noise filtering, no draw: what the
     *  history update reads where the level runs no anti-aliaser (`ANTI_ALIAS_NEUTRAL`). */
    aaNeutral: GPURenderPassDescriptor
    /** Whether the anti-aliaser's target holds its neutral word since it last drew. */
    aaNeutralHeld: boolean
  }

/** The pass that clears the anti-aliaser's target to its neutral word. */
const neutralPass = (view: GPUTextureView): GPURenderPassDescriptor => ({
  label: TAA_PASS,
  colorAttachments: [
    {
      view,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: [ANTI_ALIAS_NEUTRAL, 0, 0, 0],
    },
  ],
})

/** The textures of one size the analysis makes, given back together: `target` and `named` make
 *  them at `size`, `occluders` the buffer of occluder words, `clear` retires every texture. */
function createTargetPool(device: GPUDevice) {
  const textures: GPUTexture[] = []
  const size = { width: 0, height: 0 }
  /** A target of `format` at the size, its view. */
  const target = (label: string, format: GPUTextureFormat, usage?: number) => {
    const texture = device.createTexture({
      label,
      size: { ...size },
      format,
      usage: usage ?? GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    textures.push(texture)
    return texture.createView()
  }
  return {
    size,
    target,
    /** One target for each of `formats`, named by it. */
    named: <Name extends string>(formats: Record<Name, GPUTextureFormat>, suffix: string) =>
      Object.fromEntries(
        Object.entries<GPUTextureFormat>(formats).map(([name, format]) => [
          name,
          target(`Trillion3D TAA ${name}${suffix}`, format),
        ]),
      ) as Record<Name, GPUTextureView>,
    /** The buffer of `slices` occluder words for each texel of the size. */
    occluders: (slices: number) =>
      device.createBuffer({
        label: 'Trillion3D TAA closest occluders',
        size: slices * size.width * size.height * OCCLUDER_BYTES,
        usage: GPUBufferUsage.STORAGE,
      }),
    /** Retires every texture and forgets the size. */
    clear() {
      for (const texture of textures) retire(device, texture)
      textures.length = 0
      size.width = size.height = 0
    },
  }
}

/** The views of the analysis's targets at the pool's size, with the anti-aliaser's group (`layout`,
 *  naming `sampler` and `uniform`) and passes. */
function makeViews(
  device: GPUDevice,
  pool: ReturnType<typeof createTargetPool>,
  sampler: GPUSampler,
  uniform: GPUBuffer,
  layout: GPUBindGroupLayout,
): AnalysisTargetViews {
  const transient = pool.named(TRANSIENT_FORMATS, '')
  const antiAliasing = pool.target(
    'Trillion3D TAA spatial anti-aliasing',
    ANTI_ALIASING_FORMAT,
    resolveTargetUsage(),
  )
  return {
    ...transient,
    ...pool.named(RENDER_HISTORY_FORMATS, ' history'),
    antiAliasing,
    occluders: pool.occluders(1),
    occluderSlices: 1,
    aaGroup: device.createBindGroup({
      layout,
      entries: namedEntries(SPATIAL_AA_BINDINGS, {
        luma: transient.flickerThenLuma,
        view: { buffer: uniform },
        lumaSampler: sampler,
        rejection: transient.rejection,
      }),
    }),
    aaPass: taaPass([antiAliasing]),
    aaNeutralHeld: false,
    aaNeutral: neutralPass(antiAliasing),
  }
}

/**
 * THE TARGETS OF THE TEMPORAL PASS'S ANALYSIS, made at the render targets' size (`allocate`), the
 * largest a frame is drawn at, and given back (`release`; `onDrop` tells the groups that name them).
 * `layout` is the anti-aliaser's, `sampler` and `uniform` what its group names.
 */
export function createAnalysisTargets(
  device: GPUDevice,
  sampler: GPUSampler,
  uniform: GPUBuffer,
  layout: GPUBindGroupLayout,
  onDrop: () => void,
) {
  const pool = createTargetPool(device)
  let made: AnalysisTargetViews | undefined
  const drop = () => {
    if (made) retire(device, made.occluders)
    pool.clear()
    made = undefined
    onDrop()
  }
  return {
    /** The targets, made. */
    get views() {
      if (!made) throw new Error('TAA_ANALYSIS_TARGETS_MISSING')
      return made
    },
    /** The size the targets are made at, 0 × 0 before `allocate`. */
    get width() {
      return pool.size.width
    },
    get height() {
      return pool.size.height
    },
    /** Bytes of the targets as allocated. */
    get bytes() {
      if (!made) return 0
      const { width, height } = pool.size
      return (
        width * height * (ANALYSIS_BYTES_PER_PIXEL + (made.occluderSlices - 1) * OCCLUDER_BYTES)
      )
    },
    /** Makes the targets at `w × h`, the former ones dropped: the render-resolution histories start
     *  empty. */
    allocate(w: number, h: number) {
      drop()
      pool.size.width = w
      pool.size.height = h
      made = makeViews(device, pool, sampler, uniform, layout)
    },
    /** The second occluder word of every render texel, for the first orthographic image: the groups
     *  that name the words are made again. */
    addOccluderSlice(views: AnalysisTargetViews) {
      retire(device, views.occluders)
      views.occluders = pool.occluders(2)
      views.occluderSlices = 2
      onDrop()
    },
    release: drop,
  }
}
