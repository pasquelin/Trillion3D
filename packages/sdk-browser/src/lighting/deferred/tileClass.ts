/**
 * THE TILE CLASSES OF THE LIT SURFACES, and the lists the classification pass cuts them into.
 *
 * The lighting does not run one program over every pixel. The frame's surfaces are cut into tiles of
 * `TILE_PIXELS` pixels across, and each tile is lit by the cheapest program its pixels need
 * (`classifyMain`, `classifyWgsl.ts`): a tile is of the class of its most demanding pixel, and
 * appears in the list of that class alone —
 * - `simple`: the standard physical model, nothing else — no other shading model, no thin
 *   transmission, no lobe;
 * - `single`: a surface of another model (diffuse, toon), a thin two-sided one, or of a shading model a
 *   graph picks per pixel (`pixelModelOf`: skin, hair, eye), no lobe;
 * - `complex`: a surface that carries an anisotropic or clear-coat lobe.
 * A tile with no lit pixel (the background, unlit and as-is surfaces) is in no list: no light is drawn
 * over it. Each class draws its own tiles, by one indirect draw of tile quads (`tilePass.ts`).
 */
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  AS_IS_FLAG,
  MODEL_FLAG,
  SURFACE_MODEL_MASK,
  UNLIT_FLAG,
} from '../../materials/surface/surfaceModelWord.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { pixelModelOf } from '../../materials/surface/pixelModel.ts'

/** Pixels across a tile, and down it: the classification's workgroup is one tile. */
export const TILE_PIXELS = 8

/** The classes, in the order of their lists and of their indirect draws. */
export const TILE_CLASS = { simple: 0, single: 1, complex: 2 } as const
export type TileClass = (typeof TILE_CLASS)[keyof typeof TILE_CLASS]
/** The name of each class, in a label. */
export const TILE_CLASS_NAMES = ['SIMPLE', 'SINGLE', 'COMPLEX'] as const
/** Every class, the cheapest first. */
export const TILE_CLASSES: readonly TileClass[] = [
  TILE_CLASS.simple,
  TILE_CLASS.single,
  TILE_CLASS.complex,
]
const TILE_CLASS_COUNT = TILE_CLASSES.length

/** The words of one indirect draw: vertices, instances, first vertex, first instance. */
const DRAW_WORDS = 4
/** Bytes of one class's indirect draw, and where it starts in the arguments (`tileArgsAt`). */
const TILE_DRAW_BYTES = DRAW_WORDS * 4
export const tileArgsAt = (tileClass: TileClass) => tileClass * TILE_DRAW_BYTES
/** Bytes of the three classes' indirect draws. */
export const TILE_ARGS_BYTES = TILE_CLASS_COUNT * TILE_DRAW_BYTES
/** The vertices of a tile's quad: a strip of four. */
export const TILE_VERTICES = 4

/** The tiles across `pixels`. */
export const tilesAcross = (pixels: number) => ceilDiv(pixels, TILE_PIXELS)
/** The tiles of a `width` × `height` image: the length of one class's list, which every class may need. */
const tileCount = (width: number, height: number) => tilesAcross(width) * tilesAcross(height)
/** Bytes of the lists of an image of `width` × `height`: a word a tile, a list a class. */
export const tileListBytes = (width: number, height: number) =>
  TILE_CLASS_COUNT * tileCount(width, height) * 4

/** What `pixelTileClass` returns: 0 for a pixel no light is drawn over, else one more than the class of its tile (`TILE_CLASS`). */
export const PIXEL_CLASS = {
  none: 0,
  simple: TILE_CLASS.simple + 1,
  single: TILE_CLASS.single + 1,
  complex: TILE_CLASS.complex + 1,
} as const

/**
 * The class of a pixel from its surface flags: 0 where no light is drawn over it — the background,
 * an unlit surface, a surface shown as-is —, else one more than the class of its tile
 * (`TILE_CLASS`): 1 simple, 2 single, 3 complex. The one reading of the flags both the
 * classification and the lighting passes' own gate rest on: a pixel the passes light is a pixel it
 * classes.
 */
export const PIXEL_TILE_CLASS_WGSL = wgslBlock(
  'PIXEL_TILE_CLASS_WGSL',
  [pixelModelOf],
  `
fn pixelTileClass(flags:u32)->u32{
 let model=flags&${SURFACE_MODEL_MASK}u;
 if(model==0u||model==${UNLIT_FLAG}u||model==${AS_IS_FLAG}u){return ${PIXEL_CLASS.none}u;}
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){return ${PIXEL_CLASS.complex}u;}
 if(model!=${MODEL_FLAG.physical}u||(flags&${SUBSURFACE_FLAG}u)!=0u||pixelModelOf(flags)!=0u){return ${PIXEL_CLASS.single}u;}
 return ${PIXEL_CLASS.simple}u;
}`,
)
