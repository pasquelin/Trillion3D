import { retire } from '../../gpu/core/frameRetire.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { keptTexture } from './keptTexture.ts'
import { CLOSEST_FORMAT, MARKS_FORMAT } from './velocityWgsl.ts'
import { REPROJECTED_FORMAT, FLICKER_FORMAT } from './reprojectWgsl.ts'
import { THIN_GEOMETRY_FORMAT } from './thinGeometryWgsl.ts'
import { REJECTION_FORMAT } from './rejectionWgsl.ts'
import {
  ANTI_ALIAS_MASK,
  LDR_LUMA,
  type StorageForm,
  type StorageResource,
} from './storageForms.ts'
import { sceneColorWords } from './colorSpaceWgsl.ts'
import { MEASURE_LAYER_COUNT, MEASURE_LAYERS } from './flickerLumaWgsl.ts'
import { FIELD_FORMAT, FIELD_LAYERS } from './reprojectionFieldWgsl.ts'
import { slotsOf, type FrameSequence } from './historyFrames.ts'
import type { HistoryFormats } from './historyShape.ts'

/** The closest occluders scattered where they stood: a word per render texel, and a second one
 *  under an orthographic projection (`velocityWgsl.ts`), made by the first orthographic image. */
const OCCLUDER_BYTES = 4

/** The render-resolution targets of one image, each named by what it holds between which passes:
 *  the closest depth, the reprojection word, the velocity marks, the flicker history reprojected
 *  and the rejection the history update reads. The vectors the reprojection starts from are the
 *  velocity stage's (`../velocity.ts`), which the motion blur reads after the pass: none is kept
 *  here. */
const TRANSIENT_FORMATS = {
  closest: CLOSEST_FORMAT,
  reprojected: REPROJECTED_FORMAT,
  marks: MARKS_FORMAT,
  moireReprojected: FLICKER_FORMAT,
  rejection: REJECTION_FORMAT,
} as const
/** The textures of layers (`GUIDE_LAYERS` of `reprojectWgsl.ts`, `FIELD_LAYERS`), each written by one
 *  pass through one binding: the shading histories reprojected — the last image's frame's, and the
 *  resurrected frame's where the history keeps frames to resurrect from —; the reprojection field
 *  — the hole-filled vector, and the jacobian where the history reprojects by the field. */
const guideLayersOf = (sequence: FrameSequence) => (sequence.storage > 1 ? 2 : 1)
const fieldLayersOf = (field: boolean) => (field ? 2 : 1)
/** The scene colour the shading rejection writes as a buffer in the history's colour format
 *  (`sceneColorWords`), which the history update reads. */
const sceneColorBytes = (color: GPUTextureFormat) => 4 * sceneColorWords(color)
/** What the reprojection field adds beside its layers: its boundary. */
const BOUNDARY_FORMAT = FIELD_FORMAT

const bytesOf = (formats: Record<string, GPUTextureFormat>) =>
  Object.values(formats).reduce((bytes, format) => bytes + texelBytesOf(format), 0)

/** Bytes per render pixel of the analysis of a history that keeps the frames of `sequence`,
 *  reprojects by the field when `field`, masks the anti-aliaser when `antiAliased` (the mask and the
 *  LDR luma it browses are made then alone), and whose anti-aliaser's target and shading histories
 *  are of `formats` (`HistoryFormats`): its scene colour buffer, its
 *  targets, the anti-aliaser's, the layers of the reprojected shading histories and of the field,
 *  the flicker and thin geometry histories, a shading history for each frame, the field's
 *  boundary where it reprojects by it, and a perspective's occluder word — an orthographic view adds
 *  one word more. */
export const analysisBytesPerPixel = (
  sequence: FrameSequence,
  field: boolean,
  antiAliased: boolean,
  { antiAlias, guide, color, measure, mask, luma }: AnalysisFormats,
) =>
  bytesOf(TRANSIENT_FORMATS) +
  MEASURE_LAYER_COUNT * texelBytesOf(measure) +
  sceneColorBytes(color) +
  texelBytesOf(antiAlias) +
  (antiAliased ? ANTI_ALIAS_MASK.texelBytes[mask] + LDR_LUMA.texelBytes[luma] : 0) +
  guideLayersOf(sequence) * texelBytesOf(guide) +
  fieldLayersOf(field) * texelBytesOf(FIELD_FORMAT) +
  texelBytesOf(FLICKER_FORMAT) +
  texelBytesOf(THIN_GEOMETRY_FORMAT) +
  slotsOf(sequence) * texelBytesOf(guide) +
  (field ? texelBytesOf(BOUNDARY_FORMAT) : 0) +
  OCCLUDER_BYTES

/** The formats an analysis stores to: the anti-aliaser's target, the shading histories and the
 *  scene colour, in the history's colour format. */
export type AnalysisFormats = Pick<
  HistoryFormats,
  'antiAlias' | 'guide' | 'color' | 'measure' | 'mask' | 'luma'
>

/** What an analysis is made for: the frames its history keeps, whether it reprojects by the field
 *  and its formats. */
export interface AnalysisShape {
  readonly sequence: FrameSequence
  readonly field: boolean
  /** Whether the level runs the spatial anti-aliaser, which the rejection's mask is made for. */
  readonly antiAlias: boolean
  readonly formats: AnalysisFormats
}

/** The analysis's targets at one size: the views its passes name, and the occluder words. */
export type AnalysisTargetViews = Record<keyof typeof TRANSIENT_FORMATS, GPUTextureView> & {
  /** The reprojected shading histories, all their layers: the reprojection writes them, the
   *  shading rejection reads them. */
  guidesReprojected: GPUTextureView
  /** The reprojection field, all its layers (the shading rejection writes the resurrected pixels'),
   *  then its vector's layer alone (the reprojection writes it, the history update reads it), its
   *  jacobian's (the nearest velocity writes it; a stand-in where the history reprojects by no
   *  field) and its boundary (likewise). */
  field: GPUTextureView
  vectors: GPUTextureView
  jacobian: GPUTextureView
  boundary: GPUTextureView
  /** The flicker history: the shading rejection writes it, the next image's reprojection reads it. */
  moire: GPUTextureView
  /** The scene colour (`sceneColorWgsl`) of each render texel. */
  sceneColor: GPUBuffer
  /** The LDR luma as the groups bind it: an `r8unorm` texture, or a buffer of packed bytes
   *  (`StorageForm`), where the level runs the anti-aliaser; a texel or a word standing in else. */
  luma: GPUTextureView | GPUBufferBinding
  /** The thin geometry detection's output, which its weight relaxation reads (`thinGeometryWgsl.ts`). */
  thin: GPUTextureView
  /** The measures and the thin geometry's outputs, a layer each (`MEASURE_LAYERS`): the flicker
   *  luma and the material's coverage measured before the translucency, the thin geometry's mask
   *  and coverage history. */
  measureLuma: GPUTextureView
  measureCoverage: GPUTextureView
  thinMask: GPUTextureView
  thinHistory: GPUTextureView
  /** The shading history of each frame of the history, by slot (`slotsOf`). */
  guides: GPUTextureView[]
  antiAliasing: GPUTextureView
  /** The texels the shading rejection asks the anti-aliaser on, 1 or 0 (`StorageForm`), as
   *  the groups bind it: an `r8uint` texture, or a buffer of a word a texel, where the level runs
   *  the anti-aliaser; a texel or a word standing in else. */
  antiAliasMask: GPUTextureView | GPUBufferBinding
  occluders: GPUBuffer
  /** The occluder words a render texel has: one, two once an orthographic image was drawn. */
  occluderSlices: number
}

/** The textures of one size the analysis makes, kept in `textures`: `target` and `named` make them
 *  at `size`, `layered` one of layers, `standIn` one that stands for a target not made. */
function createTextureMaker(
  device: GPUDevice,
  size: { width: number; height: number },
  textures: GPUTexture[],
) {
  /** A target of `format` at the size, `layers` of them. */
  const texture = (label: string, format: GPUTextureFormat, layers = 1) => {
    return keptTexture(device, textures, {
      label,
      size: { ...size, depthOrArrayLayers: layers },
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
  }
  return {
    target: (label: string, format: GPUTextureFormat) => texture(label, format).createView(),
    /** What stands in for a target of `format` that is not made: a texel bound, never read, written
     *  where a program's store is folded away. */
    standIn(label: string, format: GPUTextureFormat) {
      const made = standInTexture(device, label, format, { storage: true })
      textures.push(made)
      return made.createView()
    },
    /** A target of `layers` layers of `format`: the view of all of them, and one of each. */
    layered(label: string, format: GPUTextureFormat, layers: number) {
      const made = texture(label, format, layers)
      return {
        all: made.createView({ dimension: '2d-array' }),
        layer: (at: number) =>
          made.createView({ dimension: '2d', baseArrayLayer: at, arrayLayerCount: 1 }),
      }
    },
    /** One target for each of `formats`, named by it. */
    named: <Name extends string>(formats: Record<Name, GPUTextureFormat>) =>
      Object.fromEntries(
        Object.entries<GPUTextureFormat>(formats).map(([name, format]) => [
          name,
          texture(`Trillion3D TAA ${name}`, format).createView(),
        ]),
      ) as Record<Name, GPUTextureView>,
  }
}

/** The textures and buffers of one size the analysis makes, given back together (`clear`):
 *  `occluders` makes the buffer of occluder words. */
function createTargetPool(device: GPUDevice) {
  const textures: GPUTexture[] = [],
    buffers: GPUBuffer[] = []
  const size = { width: 0, height: 0 }
  return {
    size,
    ...createTextureMaker(device, size, textures),
    /** A storage buffer of `words` words. */
    buffer: (label: string, words: number) => {
      const made = device.createBuffer({
        label,
        size: Math.max(4, 4 * words),
        usage: GPUBufferUsage.STORAGE,
      })
      buffers.push(made)
      return made
    },
    /** The buffer of `slices` occluder words for each texel of the size. */
    occluders: (slices: number) =>
      device.createBuffer({
        label: 'Trillion3D TAA closest occluders',
        size: slices * size.width * size.height * OCCLUDER_BYTES,
        usage: GPUBufferUsage.STORAGE,
      }),
    /** Retires every texture and buffer and forgets the size. */
    clear() {
      for (const made of textures) retire(device, made)
      for (const made of buffers) retire(device, made)
      textures.length = buffers.length = 0
      size.width = size.height = 0
    },
  }
}

/** The target of `resource` in `form`: made where `used`, else a texel or a word standing in. */
function storageTarget(
  pool: ReturnType<typeof createTargetPool>,
  resource: StorageResource,
  form: StorageForm,
  used: boolean,
) {
  const { label, format } = resource
  if (form === 'texture')
    return used ? pool.target(label, format) : pool.standIn(`${label} none`, format)
  const words = used ? resource.words(pool.size.width * pool.size.height) : 1
  return { buffer: pool.buffer(label, words) }
}

/** The views of the analysis's targets at the pool's size for a history of `shape`. */
function makeViews(
  pool: ReturnType<typeof createTargetPool>,
  shape: AnalysisShape,
): AnalysisTargetViews {
  const transient = pool.named(TRANSIENT_FORMATS)
  const guidesReprojected = pool.layered(
    'Trillion3D TAA guidesReprojected',
    shape.formats.guide,
    guideLayersOf(shape.sequence),
  )
  const field = pool.layered('Trillion3D TAA field', FIELD_FORMAT, fieldLayersOf(shape.field))
  const measure = pool.layered(
    'Trillion3D TAA measures',
    shape.formats.measure,
    MEASURE_LAYER_COUNT,
  )
  const guides = Array.from({ length: slotsOf(shape.sequence) }, (_, slot) =>
    pool.target(`Trillion3D TAA shading history ${slot}`, shape.formats.guide),
  )
  return {
    ...transient,
    guidesReprojected: guidesReprojected.all,
    field: field.all,
    vectors: field.layer(FIELD_LAYERS.vector),
    jacobian: shape.field
      ? field.layer(FIELD_LAYERS.jacobian)
      : pool.standIn('Trillion3D TAA jacobian none', FIELD_FORMAT),
    boundary: shape.field
      ? pool.target('Trillion3D TAA boundary', BOUNDARY_FORMAT)
      : pool.standIn('Trillion3D TAA boundary none', BOUNDARY_FORMAT),
    moire: pool.target('Trillion3D TAA moire history', FLICKER_FORMAT),
    sceneColor: pool.buffer(
      'Trillion3D TAA scene colour',
      pool.size.width * pool.size.height * sceneColorWords(shape.formats.color),
    ),
    luma: storageTarget(pool, LDR_LUMA, shape.formats.luma, shape.antiAlias),
    thin: pool.target('Trillion3D TAA thin geometry', THIN_GEOMETRY_FORMAT),
    measureLuma: measure.layer(MEASURE_LAYERS.luma),
    measureCoverage: measure.layer(MEASURE_LAYERS.coverage),
    thinMask: measure.layer(MEASURE_LAYERS.mask),
    thinHistory: measure.layer(MEASURE_LAYERS.history),
    guides,
    antiAliasing: pool.target('Trillion3D TAA spatial anti-aliasing', shape.formats.antiAlias),
    antiAliasMask: storageTarget(pool, ANTI_ALIAS_MASK, shape.formats.mask, shape.antiAlias),
    occluders: pool.occluders(1),
    occluderSlices: 1,
  }
}

/**
 * THE TARGETS OF THE TEMPORAL PASS'S ANALYSIS, made at the render targets' size (`allocate`), the
 * largest a frame is drawn at, for the history of a `shape`, and given back (`release`; `onDrop`
 * tells the groups that name them).
 */
export function createAnalysisTargets(device: GPUDevice, onDrop: () => void) {
  const pool = createTargetPool(device)
  let made: AnalysisTargetViews | undefined
  let kept: AnalysisShape | undefined
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
    /** The shape the targets were made for, none before `allocate`. */
    get shape() {
      return kept
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
      if (!made || !kept) return 0
      const { width, height } = pool.size
      return (
        width *
        height *
        (analysisBytesPerPixel(kept.sequence, kept.field, kept.antiAlias, kept.formats) +
          (made.occluderSlices - 1) * OCCLUDER_BYTES)
      )
    },
    /** Makes the targets at `w × h` for `shape`, the former ones dropped: the render-resolution
     *  histories start empty. */
    allocate(w: number, h: number, shape: AnalysisShape) {
      drop()
      pool.size.width = w
      pool.size.height = h
      kept = shape
      made = makeViews(pool, shape)
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
