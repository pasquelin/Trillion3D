import { maskOf } from './maskProgram.ts'
import { rasterOutput, rasterRegistry, type RasterProgram } from './outputProgram.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { wpoOf } from './wpoProgram.ts'

/**
 * THE DEPTH A PIXEL IS WRITTEN AT: the `pixelDepthOffset` output of a surface's graph, evaluated by
 * the visibility rasters at each pixel it covers — the software raster's pixels and the hardware
 * raster's fragments — in place of the depth of the triangle's plane: the distance, in the world's
 * units along the camera vector, a pixel is pushed away from the camera, which the depth key
 * (`visKey`) then orders it by. A surface that wires it is a surface the rasters evaluate: its rows
 * carry the cutout bit, which makes them read their coordinate (`FLAG_DEPTH_OFFSET` says which of
 * the two they ask), and its record's header the bit that names the output (`GRAPH_HEADER`).
 *
 * As the cutout's, the program is the surface's own program restricted to that output
 * (`outputProgram.ts`), and what a raster has of a pixel is the cutout's: its first texture set, its
 * footprint and the clocks. An offset that reads a world position, a camera, a normal, a vertex
 * colour or more than one texture set, or names another set than the cutout's or the vertex
 * offset's, is refused (named with the other refused graphs, `refuseGraph`) and its surface drawn at
 * the depth of its triangles.
 *
 * Not applied where the reference applies none: the shadow maps (which cast the surface where its
 * triangles are) and the tessellated surfaces (whose micro-triangles have no barycentrics to
 * evaluate it at).
 */
const depthOffsets = rasterRegistry('pixelDepthOffset', {
  kinds: ['resolve'],
  suffix: ({ compiled }) => `_${compiled.hash}`,
  blind: 'the rasters, which have',
  sameSetAs: {
    others: (program) => [maskOf(program), wpoOf(program)],
    message:
      'the pixelDepthOffset output names another texture set than the opacityMask or worldPositionOffset: a row carries one',
  },
})

/** The depth offset program of a program, none for a program that wires no `pixelDepthOffset` or
 *  whose output a raster cannot evaluate. */
export const depthOffsetOf = depthOffsets.ofProgram

/** The function of `program`'s `pixelDepthOffset` over the colour read `sample` (`rasterOutput`). */
export const depthOffsetOutput = (program: RasterProgram, sample: WgslDecl) =>
  rasterOutput(program.compiled, 'pixelDepthOffset', program.suffix, sample)
