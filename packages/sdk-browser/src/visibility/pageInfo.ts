import { fieldLayout } from '../gpu/core/fieldLayout.ts'

/**
 * A page-table row (`PageInfo`) in one table: the WGSL struct the shaders read
 * (`shader/pageWgsl.ts`, `PAGE_INFO_STRUCT_WGSL`), each field's first word, which the row writer
 * and every row reader index (`PAGE_INFO.at`), and the row's words. A row holds what its geometry
 * and its placement decide, and names its surface's record in the material table (`material`,
 * `../webgpu/material/materialTable.ts`): none of the surface's values, which a material's edit
 * writes once, in its record, and no row.
 */
export const PAGE_INFO = fieldLayout('PageInfo', [
  ['world', 'mat4x4f'],
  // The geometry's flags OR'd with its surface's (`../webgpu/row/pageRowMaterial.ts`): what the
  // passes branch on without reading the record.
  ['flags', 'u32'],
  // The page's place in the geometry pool, in words: what a slot move writes again, the occupant
  // kept (`../webgpu/row/writers.ts`, `replace`).
  ['pageOffset', 'u32'],
  // How many indices the page draws: what the GPU reads to draw it, and so the only vertex count
  // an image walk needs to reread.
  ['indexCount', 'u32'],
  // The geometry's first vertex in the shared pools, and the row's identifier base
  // (`packedRowBase`, `../webgpu/row/pageRow.ts`).
  ['vertexBase', 'u32'],
  ['packedBase', 'u32'],
  ['clusterHash', 'u32'],
  // The row's Hi-Z slot; `NO_INDEX` for a row never culled (`neverCulled`), which every reader of
  // the verdict draws unjudged (`HIZ_REJECTED_WGSL`, `rowVerdict`).
  ['hizSlot', 'u32'],
  ['selectionIndex', 'u32'],
  // One on a coarse row (`PageRec.role`), which the level-of-detail view reads.
  ['pad1', 'f32'],
  ['depthBias', 'u32'],
  // The line's placement, and the resolve class key (`shader/materialClass.ts`).
  ['placement', 'u32'],
  ['materialClass', 'u32'],
  // `deform` is the float-pool record address plus one, zero without deformation; `deformOutput`
  // carries the `DEFORM_*` bits (`types.ts`).
  ['deform', 'u32'],
  ['deformCount', 'u32'],
  ['deformOutput', 'u32'],
  // The rank of the surface's record in the material table and its second UV set's bit
  // (`MATERIAL_SECOND_UV`, `../webgpu/material/materialTable.ts`).
  ['material', 'u32'],
] as const)
