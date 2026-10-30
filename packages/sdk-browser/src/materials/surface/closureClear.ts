import { layerView } from '../../gpu/core/textureViews.ts'
import type { SurfaceBuffer } from './surfaceBuffer.ts'
import { SURFACE_WORD_LAYERS, closureWordLayers } from './surfaceOutputs.ts'

/** The most bytes of colour attachments one render pass holds a sample (the default limit of every device). */
const ATTACHMENT_BYTES = 32
/** The bytes of a layer of the words (one 32-bit word). */
const WORD_BYTES = 4
/** The bytes of a layer of the colours (four half floats). */
const COLOUR_BYTES = 8

const NONE: readonly GPURenderPassDescriptor[] = []
const held = new WeakMap<SurfaceBuffer, readonly GPURenderPassDescriptor[]>()

/** The clear of `views`, every attachment cleared to zero, in passes of the attachments one pass holds. */
function clears(views: readonly GPUTextureView[], bytes: number, label: string) {
  const each = Math.floor(ATTACHMENT_BYTES / bytes)
  const passes: GPURenderPassDescriptor[] = []
  for (let at = 0; at < views.length; at += each)
    passes.push({
      label,
      colorAttachments: views.slice(at, at + each).map((view) => ({
        view,
        loadOp: 'clear' as const,
        storeOp: 'store' as const,
        clearValue: [0, 0, 0, 0],
      })),
    })
  return passes
}

/**
 * THE CLEAR OF THE CLOSURE SLICES of a record that holds several closures (`SurfaceBuffer.closures`): the surface views the resolve's own
 * clear covers (`../../frame/prepare/attachments.ts`) are the single-closure record's, and a render pass holds a sample's colour
 * attachments to 32 bytes, so the words past the flags — the coverages and the closure offsets — are cleared by passes of no draw beside it,
 * the pixels no class shades holding no closure; and the normal and roughness of every closure past the first, the pixel data the screen
 * probes read of a closure (`SurfaceBuffer.closureNormals`), cleared as the reference clears its packed pixel data of the closures past the
 * first (`StochasticLighting.cpp:816`): a pixel without the closure shows a normal of zero, which no lit surface has. The rest of the
 * slices' colours are not: a reader takes them only where the coverage is not zero, and the resolve writes both together. None for a record
 * of one closure. Made once for a record.
 */
export function closureClears(surfaces: SurfaceBuffer): readonly GPURenderPassDescriptor[] {
  if (!(surfaces.closures > 1)) return NONE
  let made = held.get(surfaces)
  if (!made) {
    const words = Array.from({ length: closureWordLayers(surfaces.closures) }, (_, at) =>
      layerView(surfaces.words, SURFACE_WORD_LAYERS + at),
    )
    made = [
      ...clears(words, WORD_BYTES, 'Trillion3D surface closure words clear'),
      ...clears(
        surfaces.closureNormals,
        COLOUR_BYTES,
        'Trillion3D surface closure pixel data clear',
      ),
    ]
    held.set(surfaces, made)
  }
  return made
}
