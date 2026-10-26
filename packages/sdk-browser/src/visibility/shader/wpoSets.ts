import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { BLEND_BINDINGS, SHADE_BINDINGS, VIS_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { TESS_BINDINGS } from '../tessellation/bindings.ts'
import type { GraphRasters } from '../../materials/graph/graphRasters.ts'
import { BLEND_KEY, type RasterProgram } from '../../materials/graph/outputProgram.ts'
import type { SurfaceProgram } from '../../materials/graph/surfaceProgram.ts'
import type { WpoAtlas, WpoSet } from '../../materials/graph/wpoProgram.ts'
import {
  COLOR_SAMPLE_WGSL,
  colorSampleWgsl,
  SHADOW_TILE_POOL_WGSL,
} from '../../materials/virtual/wgsl.ts'

/** The offset the session holds of `program`, none if it holds none (`GraphRasters.offsets`). */
const heldOf = (rasters: GraphRasters, { id, kind }: Pick<SurfaceProgram, 'id' | 'kind'>) =>
  rasters.offsets.filter((offset) => offset.kind === kind && (offset.key & ~BLEND_KEY) === id)

/** Where a pass binds what the offsets of `programs` read: the material table (`table`), the float
 *  pool's normal atlas (`normals`), the graph frame (`frame`), and the colour read (`sample`) a
 *  texture is read by — with `atlas`, where the pass binds the colour atlas when its module declares
 *  none otherwise. */
const offsetsOn = (
  programs: readonly RasterProgram[],
  where: { table: number; normals: number; frame: number },
  sample: WgslDecl = COLOR_SAMPLE_WGSL,
  atlas?: WpoAtlas,
): WpoSet => ({ programs, ...where, sample, ...(atlas && { atlas }) })

/** The colour read of a pass that has no view uniform to take a level bias from: the atlas's finest
 *  level, which a vertex reads whatever. */
const FINEST_SAMPLE = colorSampleWgsl(SHADOW_TILE_POOL_WGSL)

const VIS_WHERE = {
  table: VIS_BINDINGS.material,
  normals: VIS_BINDINGS.normals,
  frame: VIS_BINDINGS.frame,
}

/**
 * THE OFFSETS A MODULE HOLDS when it places vertices from the visibility layout's bindings: the
 * material table, the float pool's normal atlas and the graph frame where the visibility raster binds
 * them (`VIS_BINDINGS`), which the compute raster, the surface resolve and the shadow raster bind at
 * the same numbers. Every offset program the session's surfaces wear (`GraphRasters.offsets`): a
 * surface whose graph joins later is not moved by a module made before it. The camera's passes read
 * a texture by the camera's colour read; the shadow raster's (`shadowWpo`) by the shadows'.
 */
export const visibilityWpo = (rasters: GraphRasters) => offsetsOn(rasters.offsets, VIS_WHERE)

/** The offsets of the shadow raster: the visibility layout's
 *  numbers, a texture read by the pool at no level bias. */
export const shadowWpo = (rasters: GraphRasters) =>
  offsetsOn(rasters.offsets, VIS_WHERE, FINEST_SAMPLE)

/** The offsets the voxel slots of the camera's raster and of the shadow raster hold (`visVoxelWgsl.ts`,
 *  `renderVoxelWgsl.ts`): the visibility layout's numbers, a module of their own that declares the
 *  colour atlas, which the visibility layout binds, for an offset that reads a texture, at no level
 *  bias. The brick's box moves by the offset at its centre. */
export const voxelWpo = (rasters: GraphRasters) =>
  offsetsOn(rasters.offsets, VIS_WHERE, FINEST_SAMPLE, {
    color: VIS_BINDINGS.color,
    sampler: VIS_BINDINGS.sampler,
  })

const TESS_WHERE = {
  table: TESS_BINDINGS.material,
  normals: TESS_BINDINGS.normals,
  frame: TESS_BINDINGS.frame,
}

/**
 * The offsets the tessellation holds where it places a patch's corners — the seeding and the splitting
 * of the image and the shadow maps' splitting (`../tessellation/`): the numbers of its group for the
 * records, the normal atlas and the frame, the colour atlas bound beside them for an offset that
 * reads a texture, at no level bias. The dicing declares the atlas itself (`diceWpo`).
 */
export const tessellationWpo = (rasters: GraphRasters) =>
  offsetsOn(rasters.offsets, TESS_WHERE, FINEST_SAMPLE, {
    color: TESS_BINDINGS.color,
    sampler: TESS_BINDINGS.sampler,
  })

/** The offsets the shadow maps' splitting holds (`../../lighting/shadows/vsm/tessellation/`): those
 *  that read no texture, its stage having no room for the colour atlas's page table. */
export const shadowSplitWpo = (rasters: GraphRasters) =>
  offsetsOn(
    rasters.offsets.filter((program) => !program.uses.textures),
    TESS_WHERE,
  )

/** The offsets of the dicing, whose module declares the colour atlas and its sampler: the same
 *  corners as the seeding and the splitting place. */
export const diceWpo = (rasters: GraphRasters) => offsetsOn(rasters.offsets, TESS_WHERE)

/** The offsets the shadow maps' vertex stage of the patches holds: those of the shadow raster, the
 *  colour atlas it declares only where it cuts a masked row out (`vertexCut`), so that an offset that
 *  reads a texture is held there alone. */
export const patchVertexWpo = (rasters: GraphRasters, vertexCut: boolean) =>
  offsetsOn(
    vertexCut ? rasters.offsets : rasters.offsets.filter((program) => !program.uses.textures),
    VIS_WHERE,
    FINEST_SAMPLE,
  )

/** The offset the surface resolve of a class of `program` holds, if the session holds it: the
 *  records, the normal atlas and the frame at the resolve's numbers (`SHADE_BINDINGS`), where it
 *  places a pixel on the triangle its identifier names — a pixel of the class wears no other program. */
export const shadeWpo = (rasters: GraphRasters, program: Pick<SurfaceProgram, 'id' | 'kind'>) =>
  offsetsOn(heldOf(rasters, program), {
    table: SHADE_BINDINGS.material,
    normals: SHADE_BINDINGS.normal,
    frame: SHADE_BINDINGS.frame,
  })

/** The offsets a module of the transparent pass holds: those of `programs`, the programs of the
 *  graphs its items wear that the session holds (`held`), on the pass's own numbers for the records,
 *  the normal atlas and the frame. */
export const blendWpo = (
  rasters: GraphRasters,
  programs: readonly Pick<SurfaceProgram, 'id' | 'kind'>[],
): WpoSet =>
  offsetsOn(
    programs.flatMap((program) => heldOf(rasters, program)),
    {
      table: BLEND_BINDINGS.material,
      normals: BLEND_BINDINGS.normals,
      frame: BLEND_BINDINGS.frame,
    },
  )
