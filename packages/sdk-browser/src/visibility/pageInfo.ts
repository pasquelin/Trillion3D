import { fieldLayout } from '../gpu/core/fieldLayout.ts'

/**
 * A page-table row (`PageInfo`) in one table: the WGSL struct the shaders read
 * (`shader/pageWgsl.ts`, `PAGE_INFO_STRUCT_WGSL`), each field's first word, which the row writer
 * and every row reader index (`PAGE_INFO.at`), and the row's words. A row holds what its geometry
 * and its placement decide, and names its surface's record in the material table (`material`,
 * `../materials/table/materialTable.ts`): none of the surface's values, which a material's edit
 * writes once, in its record, and no row.
 */
export const PAGE_INFO = fieldLayout('PageInfo', [
  ['world', 'mat4x4f'],
  // The geometry's flags OR'd with its surface's (`../geometry/rows/page/pageRowMaterial.ts`): what the
  // passes branch on without reading the record.
  ['flags', 'u32'],
  // The page's place in the geometry pool, in words: what a slot move writes again, the occupant
  // kept (`../geometry/rows/writers.ts`, `replace`).
  ['pageOffset', 'u32'],
  // How many indices the page draws: what the GPU reads to draw it, and so the only vertex count
  // an image walk needs to reread.
  ['indexCount', 'u32'],
  // The geometry's first vertex in the shared pools, and the row's identifier base
  // (`packedRowBase`, `../geometry/rows/page/pageRow.ts`).
  ['vertexBase', 'u32'],
  ['packedBase', 'u32'],
  ['clusterHash', 'u32'],
  // The row's Hi-Z slot; `NO_INDEX` for a row never culled (`neverCulled`), which every reader of
  // the verdict draws unjudged (`HIZ_REJECTED_WGSL`, `rowVerdict`).
  ['hizSlot', 'u32'],
  ['selectionIndex', 'u32'],
  // The row's diagnostic word (`DIAGNOSTIC_WORD`, `../diagnostic/colors.ts`): its level, HLOD
  // index and error, written with the row, which every diagnostic view reads in the shader.
  ['diagnosticWord', 'u32'],
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
  // (`MATERIAL_SECOND_UV`, `../materials/table/materialTable.ts`).
  ['material', 'u32'],
] as const)

/** The level a row's diagnostic word holds (`pageDiagnosticWord`), a transparent instance's as an
 *  opaque row's: the DAG level the cut drew it at (`PageRec.level`, zero the full detail), which the level-of-detail view paints in its
 *  colour (`diagnosticLevel`); a record without one, from a cache with no DAG, counts by its role, a
 *  coarse one as level one. */
export const levelDiagnostic = (rec: { role?: string; level?: number }) =>
  rec.level ?? (rec.role === 'coarse' ? 1 : 0)
