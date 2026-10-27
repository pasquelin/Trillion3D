import { fieldLayout } from '../gpu/core/fieldLayout.ts'

/**
 * A drawn cluster's record (`PageInfo`) in one table: the WGSL struct the shaders read
 * (`shader/pageWgsl.ts`, `PAGE_INFO_STRUCT_WGSL`), each field's first word (`PAGE_INFO.at`), and the
 * record's words. The table holds one record for each cluster of the frame's list of visible
 * clusters, at the cluster's index in it (`../geometry/dag/visible/layout.ts`): written by the
 * frame's decode (`decode/decodeWgsl.ts`) from the cluster's own record
 * (`../geometry/dag/info/clusterInfoLayout.ts`), its placement's world and its placement's record
 * (`../geometry/dag/info/placementInfoLayout.ts`), never by the host. A record names its surface's
 * record in the material table (`material`, `../materials/table/materialTable.ts`) and holds none of
 * the surface's values, which a material's edit writes once, in its record.
 */
export const PAGE_INFO = fieldLayout('PageInfo', [
  ['world', 'mat4x4f'],
  // The geometry's flags OR'd with its surface's (`../geometry/clusters/infoWrite.ts`): what the
  // passes branch on without reading the record.
  ['flags', 'u32'],
  // The page's place in the geometry pool, in words.
  ['pageOffset', 'u32'],
  // How many indices the page draws: what the GPU reads to draw it.
  ['indexCount', 'u32'],
  // The geometry's first vertex in the shared pools, and the cluster's identifier base: its
  // index in the list of visible clusters plus one, above the triangle's bits (`visWords.ts`).
  ['vertexBase', 'u32'],
  ['packedBase', 'u32'],
  ['clusterHash', 'u32'],
  // The packed page the cluster is, and its placement: the page's index in the cut's tables.
  ['selectionIndex', 'u32'],
  // The cluster's diagnostic word (`DIAGNOSTIC_WORD`, `../diagnostic/colors.ts`): its level, HLOD
  // index and error, which every diagnostic view reads in the shader.
  ['diagnosticWord', 'u32'],
  ['depthBias', 'u32'],
  // The cluster's placement, and the resolve class key (`shader/materialClass.ts`).
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
  // Whether the cluster's vertices are moved by its surface's `worldPositionOffset` (`WPO_ROW_MOVES`,
  // with `WPO_ROW_VELOCITY` where the temporal pass reprojects them by where they were and
  // `WPO_ROW_ALWAYS` where the distance does not stop it) or not (0): what every pass that places a
  // vertex reads before it evaluates the offset (`shader/wpoGraphWgsl.ts`).
  ['wpo', 'u32'],
  // What the offset of the cluster's surface reads of its object (`../geometry/dag/info/placementInfoLayout.ts`):
  // the centre of the object's bounds in its primitive's space — the point the distance is measured
  // to —, the square of the distance, in metres, past which the object's offset stops (0 for never),
  // and the most the offset may move a vertex along an axis (0 for no limit).
  ['wpoCentre', 'vec3f'],
  ['wpoDisableSq', 'f32'],
  ['wpoMost', 'f32'],
  // The marks of the cluster's object that its placement gives (`PLACEMENT_PAGE_MARKS`), which the decode
  // copies, since every bit of the row flags is taken. It fills the padding of the record's last four
  // words, so the record does not grow.
  ['marks', 'u32'],
] as const)

/** The level a row's diagnostic word holds (`pageDiagnosticWord`), a transparent instance's as an
 *  opaque row's: the DAG level the cut drew it at (`PageRec.level`, zero the full detail), which the level-of-detail view paints in its
 *  colour (`diagnosticLevel`); a record without one, from a cache with no DAG, counts by its role, a
 *  coarse one as level one. */
export const levelDiagnostic = (rec: { role?: string; level?: number }) =>
  rec.level ?? (rec.role === 'coarse' ? 1 : 0)
