import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import type { GraphOutput } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import type { CompiledGraph } from './compile.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { refuseGraph } from './kept.ts'
import { outputBlock, valuesBlock, valuesStruct } from './program.ts'
import { singleSetOf, type Uses } from './state.ts'
import {
  isProgram,
  programOf,
  type GraphSurface,
  type ProgramKind,
  type SurfaceProgram,
} from './surfaceProgram.ts'

/**
 * A SURFACE'S PROGRAM, ITS OUTPUTS EVALUATED APART: the form in which the passes that decide where a
 * surface is and what it covers read its graph, the cutout (`maskProgram.ts`) and the offset that
 * moves its vertices (`wpoProgram.ts`). The values the surface writes beside its record are laid out
 * by the whole program, so a pass reads them as the resolve does: `rasterValues` keeps the program's
 * slots, hash and suffix and declares its values alone, for the loader (`tableValues.ts`); each
 * output is its own block (`rasterOutput`), a texture read finding its footprint by the neighbours'
 * contexts the pass fills. A module lists the outputs it evaluates and no more, so one that moves
 * vertices but cuts nothing declares no colour read for a cutout's texture.
 */

/** The values of `compiled` alone, named by `suffix`: its structure and its loader's name. */
export const rasterValues = (compiled: CompiledGraph, suffix: string): CompiledGraph => ({
  ...compiled,
  suffix,
  values: valuesStruct(suffix),
  functions: {},
  outputs: [],
  wgsl: valuesBlock(compiled.hash, suffix, compiled.slots),
})

/** The function of output `name` of `compiled`, named by `suffix`, on the colour read `sample`
 *  where it reads a texture. */
export function rasterOutput(
  compiled: CompiledGraph,
  name: GraphOutput,
  suffix: string,
  sample?: WgslDecl,
): WgslDecl {
  const output = compiled.outputs.find((o) => o.name === name)
  if (!output) throw new Error(`the program does not wire ${name}`)
  if (output.uses.textures && !sample)
    throw new Error(`${name} reads a texture: no colour read given`)
  return outputBlock(compiled.hash, suffix, output, rasterValues(compiled, suffix).wgsl, sample)
}

/** The high bit of a program's key: a transparent pass's, whose ids count from one as the opaque
 *  resolve's do. */
export const BLEND_KEY = 0x80000000

/** A program restricted to one of the outputs the rasters evaluate. */
export interface RasterProgram {
  readonly kind: ProgramKind
  /** The program's id, the high bit set for a transparent pass's (`BLEND_KEY`): what a header of values
   *  names it by. */
  readonly key: number
  readonly compiled: CompiledGraph
  /** What the output alone uses: its texture sets, textures, clocks, position and normal. */
  readonly uses: Uses
  /** The one texture set the output reads: the lowest it names, the first where it names none. */
  readonly set: number
  /** Names the declarations of the output in a module that holds several. */
  readonly suffix: string
}

/** What a kind of raster output accepts: the passes whose programs it evaluates, how its
 *  declarations are named, and what it refuses, in this order — a reader that sees no world position,
 *  camera, normal or vertex colour (`blind` names it and its verb: `the rasters, which have`), what
 *  `accept` throws on (naming why), an output that names more than one texture set, and one that
 *  names another set than the outputs `sameSetAs` lists, which a row carries one set for
 *  (`message` says it). The texture set it reads is the result. */
export interface RasterRules {
  readonly kinds: readonly ProgramKind[]
  readonly suffix: (program: SurfaceProgram) => string
  readonly blind?: string
  readonly accept?: (program: SurfaceProgram, uses: Uses, textures: boolean) => void
  readonly sameSetAs?: {
    readonly others: (program: SurfaceProgram) => readonly (RasterProgram | undefined)[]
    readonly message: string
  }
}

/** The texture set the output `output` of `program` reads, or the refusal `rules` give. */
function acceptedSet(
  output: GraphOutput,
  rules: RasterRules,
  program: SurfaceProgram,
  uses: Uses,
  textures: boolean,
) {
  if (rules.blind && (uses.position || uses.normal || uses.colour))
    throw graphError(
      `the ${output} output is read by ${rules.blind} no world position, camera, normal or vertex colour`,
    )
  rules.accept?.(program, uses, textures)
  const set = singleSetOf(uses.sets, `${output} output`)
  for (const other of rules.sameSetAs?.others(program) ?? [])
    if (other?.uses.sets && uses.sets && other.set !== set)
      throw graphError(rules.sameSetAs!.message)
  return set
}

/**
 * THE PROGRAMS OF ONE RASTER OUTPUT, built once for each program of a surface graph and each answer
 * of the device (`ofProgram`):
 * restricted to `output`, or none for a program that does not wire it or whose output a raster
 * cannot evaluate (refused, named with the other refused graphs, `refuseGraph`). One registry for the
 * cutout (`maskProgram.ts`) and the offset (`wpoProgram.ts`).
 */
export function rasterRegistry(output: GraphOutput, rules: RasterRules) {
  const built = new Map<string, RasterProgram | null>()
  const make = (program: SurfaceProgram, textures: boolean): RasterProgram | undefined => {
    const found = program.compiled.outputs.find((o) => o.name === output)
    if (!found) return undefined
    try {
      const set = acceptedSet(output, rules, program, found.uses, textures)
      const key = (program.id | (program.kind === 'blend' ? BLEND_KEY : 0)) >>> 0
      return {
        kind: program.kind,
        key,
        compiled: program.compiled,
        uses: found.uses,
        set,
        suffix: rules.suffix(program),
      }
    } catch (error) {
      refuseGraph(error)
      return undefined
    }
  }
  const ofProgram = (program: SurfaceProgram, textures = true): RasterProgram | undefined => {
    if (!rules.kinds.includes(program.kind)) return undefined
    const id = `${program.kind}:${program.id}:${textures}`
    let made = built.get(id)
    if (made === undefined) built.set(id, (made = make(program, textures) ?? null))
    return made ?? undefined
  }
  return {
    /** The output's program of `program`; `textures` says whether a vertex stage may read the colour
     *  atlas (`grantsVertexTextures`). */
    ofProgram,
    /** The output's program a surface's graph draws, none for a surface without one. */
    ofSurface(surface: GraphSurface, textures = true) {
      const program = surface.graph && programOf(surface)
      return isProgram(program) ? ofProgram(program, textures) : undefined
    },
  }
}
