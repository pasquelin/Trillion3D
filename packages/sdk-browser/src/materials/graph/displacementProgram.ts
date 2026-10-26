import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { maskOf } from './maskProgram.ts'
import { rasterOutput, rasterRegistry, type RasterProgram } from './outputProgram.ts'
import { depthOffsetOf } from './pdoProgram.ts'
import { wpoOf } from './wpoProgram.ts'

/**
 * THE HEIGHT A SURFACE IS DISPLACED BY: the `displacement` output of a surface's graph, in 0 to 1,
 * read by the tessellation (`../../visibility/tessellation/`) at each point it makes, in place of the
 * height map's: the point moves along its normal by `(height - centre) * magnitude`, the material's
 * (`Material.displacementMagnitude`, `displacementCenter`), faded by the depth of the point
 * (`displacementFadeStart`, `displacementFadeEnd`) as a map's is. The dicing and the shadow maps' dicing
 * read it where a height map is read, through the same function (`displacementValue`,
 * `../../visibility/shader/maskGraphWgsl.ts`).
 *
 * As the cutout's, the program is the surface's own program restricted to that output
 * (`outputProgram.ts`), and what the tessellation has of a point is the cutout's: its texture
 * coordinate (the one set the output names, which the row's displacement record carries), its
 * footprint and the clocks. An output that reads a world position, a camera, a normal, a vertex colour
 * or more than one texture set, or names another set than the other raster outputs of its program, is
 * refused (named with the other refused graphs, `refuseGraph`) and its surface drawn flat.
 */
const displacements = rasterRegistry('displacement', {
  kinds: ['resolve'],
  suffix: ({ compiled }) => `_${compiled.hash}`,
  blind: 'the tessellation, which has',
  sameSetAs: {
    others: (program) => [maskOf(program), wpoOf(program), depthOffsetOf(program)],
    message:
      'the displacement output names another texture set than the opacityMask, worldPositionOffset or pixelDepthOffset: a row carries one',
  },
})

/** The displacement program of a program, none for a program that wires no `displacement` or whose
 *  output the tessellation cannot evaluate. */
export const displacementOf = displacements.ofProgram
export const displacementProgramOf = displacements.ofSurface

/** The function of `program`'s `displacement` over the colour read `sample` (`rasterOutput`). */
export const displacementOutput = (program: RasterProgram, sample: WgslDecl) =>
  rasterOutput(program.compiled, 'displacement', program.suffix, sample)
