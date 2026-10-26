import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import type { AtlasBindings } from '../../gpu/bind/bindLayout.ts'
import { maskOf } from './maskProgram.ts'
import { rasterOutput, rasterRegistry, rasterValues, type RasterProgram } from './outputProgram.ts'

/**
 * THE OFFSET THAT MOVES A SURFACE'S VERTICES: the `worldPositionOffset` output of a surface's graph,
 * evaluated at each vertex by every raster that places a vertex — the visibility rasters and their
 * binning, the surface resolve and the temporal pass that rebuild a pixel's triangle, the shadow
 * depth pass and the transparent pass — in place of the vertex where the geometry has it, so that
 * all of them see the one moved surface (`visibility/shader/wpoGraphWgsl.ts`, called by
 * `pagePosition`).
 *
 * As the cutout's, the program is the surface's own program restricted to that output
 * (`outputProgram.ts`): the values it reads are those the surface writes beside its record, and it
 * is chosen by the header of those values (`GRAPH_HEADER`), which tells the programs of the opaque
 * resolve from those of the transparent pass, whose ids both start at one. What a raster has of a
 * vertex is its world position, the object's origin, the camera, its normal, its first texture
 * coordinate set and the clocks (`graphFrameWgsl.ts`), and the textures it reads where the device lets
 * a vertex stage bind the colour atlas (`grantsVertexTextures`, at an explicit level). An offset that
 * names more than one texture set, or names another set than the surface's cutout, or reads a
 * texture on a device that does not, is refused (named with the other refused graphs, `refuseGraph`)
 * and its vertices stay where they are.
 */
const offsets = rasterRegistry('worldPositionOffset', {
  kinds: ['resolve', 'blend'],
  // A transparent pass's declares its whole program under its hash, so its offset takes another name.
  suffix: ({ kind, compiled }) => (kind === 'blend' ? `_o${compiled.hash}` : `_${compiled.hash}`),
  accept: (_, uses, textures) => {
    if (uses.textures && !textures)
      throw graphError(
        'the worldPositionOffset output reads a texture, which this device’s vertex stages have no room to bind: they need ten storage buffers',
      )
  },
  sameSetAs: {
    others: (program) => [maskOf(program)],
    message:
      'the worldPositionOffset and opacityMask outputs name different texture sets: a row carries one',
  },
})

/** The offset program of a program, none for a program that wires no `worldPositionOffset` or whose
 *  offset a raster cannot evaluate; and of a surface's graph. */
export const wpoOf = offsets.ofProgram
export const wpoProgramOf = offsets.ofSurface

/**
 * The offset programs a raster's module holds the functions of, and what it reads them with:
 * `table` the binding of the material table in it, `normals` the binding of the float pool's normal
 * atlas, `frame` the binding of the graph frame (`graphFrameWgsl.ts`). None: the module is the one
 * without offsets, word for word.
 */
export interface WpoSet {
  readonly programs: readonly RasterProgram[]
  readonly table: number
  readonly normals: number
  readonly frame: number
  /** The colour read of the pass, which the programs that read a texture read it by at the finest
   *  level (the footprint of a vertex is none), and, for a module that does not declare the colour
   *  atlas already, where it binds it (`wpoAtlasWgsl`). */
  readonly sample?: WgslDecl
  readonly atlas?: WpoAtlas
}

/** Where a module that places a vertex binds the colour atlas, its page table and the sampler the
 *  texture reads of an offset use. */
export interface WpoAtlas {
  readonly color: AtlasBindings
  readonly sampler: number
}

/** No offset program. */
export const NO_WPO: WpoSet = { programs: [], table: 0, normals: 0, frame: 0 }

/** What tells two sets apart: the programs, by key, the bindings and whether they read the atlas. */
export const wpoKey = (wpo: WpoSet) =>
  `${wpo.programs.map((program) => program.key).join(',')}@${wpo.table}.${wpo.normals}.${wpo.frame}${wpo.atlas ? `.${wpo.atlas.color.pages}` : ''}`

/** The values of `program` a module declares (`rasterValues`), and the function of its offset
 *  (`rasterOutput`). */
export const wpoValues = (program: RasterProgram) => rasterValues(program.compiled, program.suffix)
export const wpoOutput = (program: RasterProgram, sample?: WgslDecl) =>
  rasterOutput(program.compiled, 'worldPositionOffset', program.suffix, sample)
