import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { rasterOutput, rasterRegistry, rasterValues, type RasterProgram } from './outputProgram.ts'
import type { PixelProgram } from './pixelProgram.ts'

/**
 * THE CUTOUT A GRAPH DRAWS: the `opacityMask` output of a surface's graph, evaluated by the rasters
 * that decide which pixels a row covers (the visibility rasters, the dicing, the shadow depth
 * passes) in place of the base map's alpha. A surface that wires it is a masked surface: its rows
 * carry the cutout bit, its record the clip value, and a raster keeps a pixel where the output
 * minus the clip value is not below zero.
 *
 * A mask is the opaque resolve's own program restricted to that one output (`outputProgram.ts`): the
 * values the surface writes beside its record are laid out by that program, so the mask reads them as
 * the resolve does, and is chosen by the program's id in the header of the values. What a raster has
 * of a pixel is its first texture set, its footprint and the clocks: a mask that reads a world
 * position, a camera, a normal, a vertex colour or more than one texture set is refused (named with the other refused
 * graphs, `refuseGraph`) and its surface drawn whole.
 */
const masks = rasterRegistry('opacityMask', {
  kinds: ['resolve'],
  suffix: ({ compiled }) => `_${compiled.hash}`,
  blind: 'the rasters, which have',
})

/** The mask of a program, none for a program that wires no `opacityMask` or whose mask a raster cannot
 *  evaluate. */
export const maskOf = masks.ofProgram

/** The value of the clip a material that names none takes, and its `alphaTest` where above 0. */
const DEFAULT_OPACITY_MASK_CLIP = 0.3333

/** The clip value of a surface's mask: the one it names, else its `alphaTest` where above 0 (a glTF
 *  material keeps its `alphaCutoff`), else the default. */
export const maskClipValue = (surface: { opacityMaskClipValue?: number; alphaTest?: number }) =>
  surface.opacityMaskClipValue ??
  ((surface.alphaTest ?? 0) > 0 ? surface.alphaTest! : DEFAULT_OPACITY_MASK_CLIP)

/**
 * The masks a raster's module holds the functions of, and how it reads a texture: `sample` the
 * declaration of its colour read (the pass's pool), `footprint` the WGSL factor its derivatives are
 * scaled by to find the level a texture is read at (the camera's pools cancel their level offset,
 * the shadows' read none), `frame` the binding of the graph frame (`graphFrameWgsl.ts`) the
 * clocks are read from, and `noise` the binding of the blue noise a dithered cutout is cut by, where
 * the pass has it. None: the module is the one without graphs and without dither, word for word.
 */
export interface MaskSet {
  readonly programs: readonly PixelProgram[]
  readonly sample?: WgslDecl
  readonly footprint?: string
  readonly frame: number
  readonly noise?: number
}

/** No graph mask, no dither. */
export const NO_MASKS: MaskSet = { programs: [], frame: 0 }

/** The masks `programs` (a session's, `GraphRasters.pixelPrograms`), read through `sample` with the scale
 *  `footprint`, the pass's cutouts dithered by the noise at `noise` where it names one. */
export const maskSetOf = (
  programs: readonly PixelProgram[],
  frame: number,
  sample: WgslDecl,
  footprint = '1.0',
  noise?: number,
): MaskSet => ({ programs, frame, sample, footprint, ...(noise !== undefined && { noise }) })

/** Whether a module's cutout test is given the pixel it cuts (`maskKeepAt`): it holds graph masks or
 *  dithers. */
export const maskKnowsPixel = (set: MaskSet) => set.programs.length > 0 || set.noise !== undefined

/** Whether a module holds a program whose `pixelDepthOffset` moves the depth its pixels are written at. */
export const maskMovesDepth = (set: MaskSet) => set.programs.some((program) => program.depthOffsets)

/** What tells two sets apart: the programs, by key, and whether it dithers. */
export const masksKey = (set: MaskSet) =>
  `${set.programs.map((mask) => mask.key).join(',')}${set.noise === undefined ? '' : `@${set.frame}.${set.noise}`}`

/** The values of `mask`'s program a module declares (`rasterValues`), and the function of its
 *  output over the colour read `sample` (`rasterOutput`). */
export const maskValues = (mask: RasterProgram) => rasterValues(mask.compiled, mask.suffix)
export const maskOutput = (mask: RasterProgram, sample: WgslDecl) =>
  rasterOutput(mask.compiled, 'opacityMask', mask.suffix, sample)
