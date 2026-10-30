import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import type { TileRect } from '../../visualizeModes.ts'
import { fieldLayout } from '../../../../gpu/core/fieldLayout.ts'

/**
 * THE SHARED FORMS OF THE SCENE VIEW'S TRIANGLE TRACE: the kernels that list the tiles and the rays of a view, trace them through the scene's triangles and shade what they meet
 * all read the same parameters and the same buffer of rays (`hardware.ts` runs them). No GPU here: the sizes and the words.
 */

/** The side of a tile of pixels, which is also the side of a group of the kernels that list them. */
export const HARDWARE_TILE = 8
/** The threads of a group of the kernels that go over the rays: one for each pixel of a tile. */
export const HARDWARE_RAY_GROUP = HARDWARE_TILE * HARDWARE_TILE
/** The groups across of a dispatch over the rays: a row of them holds as many as a dispatch may hold in the other direction. */
export const HARDWARE_DISPATCH_X = 128

/** The bits of `HardwareParams.flags.x`: the finest pages are read, the height fog is laid over the light, the draw is a tile of the overview (rounded corners). */
export const HARDWARE_FLAG = { hiRes: 1, fog: 2, tiled: 16 } as const

/**
 * The parameters of a draw, one uniform for every kernel of it: `size` the pixels across and down the draw is traced at (a whole display or a tile of the overview) and then those of the display
 * it shows; `trace` the first and last distance of the trace (metres), the depth bias the cards are read with and the nearest hit (centimetres) that takes light from them; `flags` the bits of
 * `HARDWARE_FLAG`, whether the light goes through the composition's table, the faces the rays pass (`visualizeCullingMode`) and the image's rank; `tile` the draw's corner and size in display
 * pixels; `fog` the least distance the sky is fogged over (metres).
 */
export const HARDWARE_PARAMS = fieldLayout('HardwareParams', [
  ['size', 'vec4u'],
  ['trace', 'vec4f'],
  ['flags', 'vec4u'],
  ['tile', 'vec4f'],
  ['fog', 'vec4f'],
] as const)

/** The tiles of a draw `size` pixels across and down, across and down. */
export const hardwareTiles = (size: readonly [number, number]) =>
  [ceilDiv(size[0], HARDWARE_TILE), ceilDiv(size[1], HARDWARE_TILE)] as const

/** The rays a draw `size` pixels across and down may list: a thread for each pixel of each tile. */
export const hardwareRayCapacity = (size: readonly [number, number]) => {
  const [across, down] = hardwareTiles(size)
  return across * down * HARDWARE_RAY_GROUP
}

/** The groups a dispatch over the tiles or the rays of a draw runs, as (across, down): one group for each tile, laid in rows of `HARDWARE_DISPATCH_X`. */
export const hardwareDispatchOf = (size: readonly [number, number]) => {
  const [across, down] = hardwareTiles(size)
  return [HARDWARE_DISPATCH_X, ceilDiv(across * down, HARDWARE_DISPATCH_X)] as const
}

/** The words of the first buffer of the lists: the count of tiles, then a word for each tile that holds a pixel. */
export const hardwareTileWords = (size: readonly [number, number]) => {
  const [across, down] = hardwareTiles(size)
  return 1 + across * down
}

/** Where the rays begin in the buffer of rays: after the count of them. */
export const HARDWARE_RAYS_AT = 4

/** The words of the buffer of rays for a draw `size` pixels across and down: the count, then a word for each ray. */
export const hardwareRayWords = (size: readonly [number, number]) =>
  HARDWARE_RAYS_AT + hardwareRayCapacity(size)

/** The words of the parameters of a draw: `size` the draw's pixels and the display's, `rect` its corner and size on the display. */
export function hardwareParamsOf(
  words: Uint32Array<ArrayBuffer>,
  fields: {
    readonly draw: readonly [number, number]
    readonly display: readonly [number, number]
    readonly rect: TileRect
    readonly trace: readonly [number, number, number, number]
    readonly flags: number
    readonly tonemap: boolean
    readonly culling: number
    readonly fogSky: number
  },
) {
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length)
  const P = HARDWARE_PARAMS.at
  words.set([...fields.draw, ...fields.display], P.size)
  floats.set(fields.trace, P.trace)
  words.set([fields.flags, fields.tonemap ? 1 : 0, fields.culling, 0], P.flags)
  floats.set([fields.rect.x, fields.rect.y, fields.rect.width, fields.rect.height], P.tile)
  floats.set([fields.fogSky, 0, 0, 0], P.fog)
  return words
}
