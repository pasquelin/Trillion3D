import { toHalf } from '../../../../math/src/float/half.ts'
import { SUBSURFACE_FORMAT, SUBSURFACE_TARGET } from './subsurface.ts'
import { PHYSICAL_LOBES_FORMAT, PHYSICAL_LOBES_TARGET } from './physicalLobes.ts'
import { EMISSIVE_AO_BYTES } from './surfaceEmission.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import { layerView } from '../../gpu/core/textureViews.ts'
import {
  SURFACE_CLOSURES,
  SURFACE_COLOURS_FORMAT,
  SURFACE_WORD_LAYERS,
  SURFACE_WORDS,
  SURFACE_WORDS_FORMAT,
  closureColourLayers,
  closureNormalLayer,
  closureWordLayers,
  closuresHeld,
} from './surfaceOutputs.ts'
import {
  checkSurfaceSize,
  closureBytes,
  emissiveAoBytes,
  holds,
  type SurfaceBuffer,
} from './surfaceBuffer.ts'

/** A layered target of the buffer, `layers` of `format` at `width` × `height`: each layer cleared
 *  as an attachment, every one written as storage by the material classes' shading
 *  (`../classes/materialPasses.ts`), read by load or sampled, and copied out and in by the
 *  captures (`../../frame/io/surfaceCapture.ts`). */
const layeredTarget = (
  device: GPUDevice,
  name: string,
  format: GPUTextureFormat,
  [width, height]: readonly [number, number],
  layers: number,
) =>
  device.createTexture({
    label: `Trillion3D surface ${name}`,
    size: [width, height, layers],
    format,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
  })

/** The lobes target of a buffer `size`, read by load alone (`../../gpu/core/loadOnlyTarget.ts`):
 *  full-size when `wanted`, a 1×1 otherwise. */
const lobesTarget = (device: GPUDevice, size: readonly [number, number], wanted: boolean) =>
  device.createTexture({
    label: 'Trillion3D physical lobes',
    format: PHYSICAL_LOBES_FORMAT,
    usage: loadOnlyUsage(),
    size: wanted ? size : [1, 1],
  })

/** `(0, 0, 0, 1)`'s last channel in half float. */
const HALF_ONE = toHalf(1)

/** The view of the emission-and-occlusion layer of a frame without it: a 1×1 `(0, 0, 0, 1)`. */
function noEmission(device: GPUDevice) {
  const texture = device.createTexture({
    label: 'Trillion3D emission stand-in',
    size: [1, 1],
    format: SURFACE_COLOURS_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture },
    Uint16Array.of(0, 0, 0, HALF_ONE),
    { bytesPerRow: EMISSIVE_AO_BYTES },
    [1, 1],
  )
  return texture
}

/** `texture`, kept in `made`: what a failure frees. */
const kept = (made: GPUTexture[], texture: GPUTexture) => (made.push(texture), texture)

/** What `build` makes, given the list `made` its textures are kept in: a failure of `build` frees
 *  every texture it had made (`kept`). */
function owning<T>(build: (made: GPUTexture[]) => T): T {
  const made: GPUTexture[] = []
  try {
    return build(made)
  } catch (error) {
    for (const texture of made) texture.destroy()
    throw error
  }
}

/** What the buffer holds full-size besides its targets (`createSurfaceBuffer`). */
export type SurfaceOptions = {
  subsurface?: boolean
  emissiveAo?: boolean
  lobes?: boolean
  /** The most closures a pixel holds (`effectiveMaxClosures`): one by default, the record then the single-closure one. */
  closures?: number
}

/** The surface buffer of a `width` × `height` frame. Without `emissiveAo`, the colours hold no
 *  emission-and-occlusion layer: its view is a 1×1 `(0, 0, 0, 1)`, no texel is marked
 *  (`surfaceEmitsOrOccludes`), its readers load under the mark alone (`surfaceEmissiveAo`), its
 *  passes leave the slot empty. Without `subsurface`, no thin transmission layer: its view is a 1×1
 *  zero. Without `lobes`, the lobes target is 1×1. With `closures` above one, the colours and the words hold the closure slices
 *  (`SURFACE_CLOSURES`). */
export function createSurfaceBuffer(
  device: GPUDevice,
  width: number,
  height: number,
  { subsurface = false, emissiveAo = true, lobes = false, closures = 1 }: SurfaceOptions = {},
): SurfaceBuffer {
  const allocationBytes =
    checkSurfaceSize(device, width, height) +
    closureBytes(width, height, closures) +
    SUBSURFACE_TARGET.bytes(width, height, subsurface) +
    PHYSICAL_LOBES_TARGET.bytes(width, height, lobes) -
    emissiveAoBytes(width, height, true) +
    emissiveAoBytes(width, height, emissiveAo)
  const size = [width, height] as const
  return owning((made) => {
    const words = kept(made, wordsTarget(device, size, closures))
    return assemble(
      {
        width,
        height,
        allocationBytes,
        words,
        lobes: kept(made, lobesTarget(device, size, lobes)),
      },
      colouredParts(device, size, { emissiveAo, subsurface, closures }, made),
    )
  })
}

/** The words of a buffer `size` holding `closures` closures a pixel: the flags, and the closure slices past one closure. */
const wordsTarget = (device: GPUDevice, size: readonly [number, number], closures: number) =>
  layeredTarget(
    device,
    'words',
    SURFACE_WORDS_FORMAT,
    size,
    SURFACE_WORD_LAYERS + closureWordLayers(closures),
  )

/** The parts of a buffer besides its colours: what a remade colours or lobes target keeps. */
type SurfaceParts = Pick<SurfaceBuffer, 'width' | 'height' | 'allocationBytes' | 'words' | 'lobes'>
/** A buffer's colours (`colouredParts`): the target, its layers' word, what it holds, and the
 *  stand-ins of the layers it holds not. */
type ColouredParts = Pick<
  SurfaceBuffer,
  'colours' | 'layers' | 'hasEmissiveAo' | 'hasSubsurface' | 'closures'
> & {
  standIns: { emission?: GPUTexture; thin?: GPUTexture }
}

/** The options a buffer was made with, `patch` changed. */
const optionsOf = (
  surfaces: SurfaceBuffer,
  patch: Pick<SurfaceOptions, 'emissiveAo' | 'closures'>,
): SurfaceOptions => ({
  subsurface: surfaces.hasSubsurface,
  emissiveAo: surfaces.hasEmissiveAo,
  closures: surfaces.closures,
  ...patch,
})

/** The colours of a buffer `size` — the base and the normal, then the emission and occlusion's
 *  layer with `emissiveAo`, then the thin transmission's with `subsurface`, then the closure
 *  slices of a pixel holding `closures` — and the stand-in of each it holds not; each texture made
 *  kept in `made`. */
function colouredParts(
  device: GPUDevice,
  size: readonly [number, number],
  { emissiveAo = true, subsurface = false, closures = 1 }: SurfaceOptions,
  made: GPUTexture[],
): ColouredParts {
  const emission = emissiveAo ? 2 : 0,
    thin = subsurface ? 2 + Number(emissiveAo) : 0
  const own = 2 + Number(emissiveAo) + Number(subsurface)
  const held = closuresHeld(closures)
  // The layer of the closure slices and their count ride in the head's word above the two layers, as bytes.
  const slices =
    held > 1
      ? ((own << SURFACE_CLOSURES.headShift.colours) |
          (held << SURFACE_CLOSURES.headShift.held)) >>>
        0
      : 0
  return {
    colours: kept(
      made,
      layeredTarget(
        device,
        'colours',
        SURFACE_COLOURS_FORMAT,
        size,
        own + closureColourLayers(closures),
      ),
    ),
    layers: (emission | (thin << 8) | slices) >>> 0,
    closures: held,
    hasEmissiveAo: emissiveAo,
    hasSubsurface: subsurface,
    standIns: {
      emission: emissiveAo ? undefined : kept(made, noEmission(device)),
      thin: subsurface
        ? undefined
        : kept(
            made,
            standInTexture(device, 'Trillion3D thin transmission stand-in', SUBSURFACE_FORMAT, {
              storage: true,
            }),
          ),
    },
  }
}

/** Each record's colours, for the record made from it with other targets (`withEmissiveAo`,
 *  `withLobes`). */
const COLOURED = new WeakMap<SurfaceBuffer, ColouredParts>()

function assemble(parts: SurfaceParts, coloured: ColouredParts): SurfaceBuffer {
  const { words, lobes } = parts,
    { colours, layers, standIns } = coloured
  const emission = layers & 255,
    thin = (layers >> 8) & 255
  const views = [
    layerView(colours, 0),
    layerView(colours, 1),
    emission ? layerView(colours, emission) : standIns.emission!.createView(),
    layerView(words, SURFACE_WORDS.flags),
  ]
  const stores = [
    colours.createView({ dimension: '2d-array' }),
    words.createView({ dimension: '2d-array' }),
  ] as const
  let disposed = false
  /** `value`, of a record not disposed. */
  const live = <T>(value: T) => {
    if (disposed) throw new Error('SURFACE_DISPOSED')
    return value
  }
  const record: SurfaceBuffer = {
    version: 1,
    ...parts,
    colours,
    layers,
    hasEmissiveAo: coloured.hasEmissiveAo,
    hasSubsurface: coloured.hasSubsurface,
    closures: coloured.closures,
    closureNormals: Array.from({ length: coloured.closures - 1 }, (_, at) =>
      layerView(
        colours,
        closureNormalLayer((layers >> SURFACE_CLOSURES.headShift.colours) & 255, at + 1),
      ),
    ),
    subsurfaceView: thin ? layerView(colours, thin) : standIns.thin!.createView(),
    lobesView: lobes.createView(),
    views: () => live(views),
    stores: () => live(stores),
    dispose() {
      if (disposed) return
      disposed = true
      for (const texture of [colours, words, lobes, standIns.emission, standIns.thin])
        texture?.destroy()
    },
  }
  COLOURED.set(record, coloured)
  return record
}

/** The parts of `surfaces` besides its colours, to make a record of the same targets with one
 *  replaced. */
const partsOf = ({
  width,
  height,
  allocationBytes,
  words,
  lobes,
}: SurfaceBuffer): SurfaceParts => ({
  width,
  height,
  allocationBytes,
  words,
  lobes,
})

/**
 * The same buffer with its emission-and-occlusion layer made, for an image whose surface came to
 * emit or occlude: a new record — its views, which every reader binds by, are new — on its words
 * and its lobes target, and new colours holding the layer, which it frees from now on. The colours
 * replaced and their stand-ins are retired, destroyed after the frame's submit
 * (`../../gpu/core/frameRetire.ts`): a pass already encoded may still name them. The record replaced
 * is not disposed; the image that first holds the layer writes every colour layer anew.
 */
export function withEmissiveAo(device: GPUDevice, surfaces: SurfaceBuffer): SurfaceBuffer {
  const { width, height } = surfaces
  const coloured = owning((made) =>
    colouredParts(device, [width, height], optionsOf(surfaces, { emissiveAo: true }), made),
  )
  const record = assemble(
    {
      ...partsOf(surfaces),
      allocationBytes:
        surfaces.allocationBytes -
        emissiveAoBytes(width, height, false) +
        emissiveAoBytes(width, height, true),
    },
    coloured,
  )
  const replaced = COLOURED.get(surfaces)!
  for (const texture of [replaced.colours, replaced.standIns.emission, replaced.standIns.thin])
    if (texture) retire(device, texture)
  return record
}

/**
 * The same buffer with its lobes target remade, full-size when `wanted`, a 1×1 otherwise: a lobed
 * surface that comes or goes remakes that target alone, never the frame's others. A new record on
 * the same targets; the lobes target replaced is the caller's to free once no pass names it. Its
 * bytes are read off the size it has, whatever `wanted` asks.
 */
export function withLobes(device: GPUDevice, surfaces: SurfaceBuffer, wanted: boolean) {
  const { width, height } = surfaces
  return assemble(
    {
      ...partsOf(surfaces),
      allocationBytes:
        surfaces.allocationBytes -
        PHYSICAL_LOBES_TARGET.bytes(width, height, holds(surfaces, surfaces.lobes)) +
        PHYSICAL_LOBES_TARGET.bytes(width, height, wanted),
      lobes: lobesTarget(device, [width, height], wanted),
    },
    COLOURED.get(surfaces)!,
  )
}

/**
 * The same buffer holding `count` closures a pixel (`effectiveMaxClosures`), for a view whose most changed: a new record, its views new,
 * on new colours and words holding the closure slices (none for one closure: the single-closure record), the lobes target kept. The
 * colours, words and stand-ins replaced are retired, destroyed after the frame's submit (`../../gpu/core/frameRetire.ts`); the
 * record replaced is not disposed; the image that first holds the slices writes every layer anew.
 */
export function withClosures(
  device: GPUDevice,
  surfaces: SurfaceBuffer,
  count: number,
): SurfaceBuffer {
  const { width, height } = surfaces
  const made: GPUTexture[] = []
  const size = [width, height] as const
  const replaced = COLOURED.get(surfaces)!
  const coloured = owning((own) =>
    colouredParts(device, size, optionsOf(surfaces, { closures: count }), own),
  )
  let words: GPUTexture
  try {
    words = kept(made, wordsTarget(device, size, count))
  } catch (error) {
    for (const texture of [coloured.colours, coloured.standIns.emission, coloured.standIns.thin])
      texture?.destroy()
    throw error
  }
  const record = assemble(
    {
      ...partsOf(surfaces),
      words,
      allocationBytes:
        surfaces.allocationBytes -
        closureBytes(width, height, surfaces.closures) +
        closureBytes(width, height, count),
    },
    coloured,
  )
  for (const texture of [
    replaced.colours,
    replaced.standIns.emission,
    replaced.standIns.thin,
    surfaces.words,
  ])
    if (texture) retire(device, texture)
  return record
}
