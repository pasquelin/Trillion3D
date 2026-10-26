import { maskOf } from './maskProgram.ts'
import type { RasterProgram } from './outputProgram.ts'
import { depthOffsetOf } from './pdoProgram.ts'
import { displacementOf } from './displacementProgram.ts'
import { mergeUses, noUses } from './state.ts'
import type { SurfaceProgram } from './surfaceProgram.ts'

/**
 * THE PROGRAM A RASTER EVALUATES AT A PIXEL: a surface's program restricted to what the rasters ask of
 * a covered pixel or a point of a displaced triangle — whether to keep it (the `opacityMask`
 * output, `maskProgram.ts`), the depth to write it at (the `pixelDepthOffset` output,
 * `pdoProgram.ts`) and the height to push it by (the `displacement` output,
 * `displacementProgram.ts`) —, the one program of them: its values are read once, by the header of
 * the record, whichever the raster asks. `cuts`, `depthOffsets` and `displaces` say which outputs it
 * wires; `uses` is theirs together, `set` the one texture set they read.
 */
export interface PixelProgram extends RasterProgram {
  readonly cuts: boolean
  readonly depthOffsets: boolean
  readonly displaces: boolean
}

/** The pixel program of a program, none for a program that wires neither output or whose outputs no
 *  raster can evaluate. */
export function pixelOf(program: SurfaceProgram): PixelProgram | undefined {
  const cut = maskOf(program),
    offset = depthOffsetOf(program),
    height = displacementOf(program)
  const outputs = [cut, offset, height]
  const base = outputs.find(Boolean)
  if (!base) return undefined
  const uses = noUses()
  for (const program of outputs) if (program) mergeUses(uses, program.uses)
  return {
    ...base,
    cuts: !!cut,
    depthOffsets: !!offset,
    displaces: !!height,
    uses,
    set: outputs.find((program) => program?.uses.sets)?.set ?? 0,
  }
}
