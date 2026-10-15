import type { BlendGpuItem } from './state.ts'
import type { GeometryBlock, MaterialLayers } from '../row/pageRowMaterial.ts'
import { rowFlags } from '../row/surfaceRow.ts'
import { WATER_RANK_SHIFT } from '../water/rank.ts'
import { materialWord, type MaterialTable } from '../material/materialTable.ts'
import { hasPhysicalLobes } from '../../scene/physicalLobes.ts'
import type { HostAttributes } from '../../host/resources.ts'
import type { SessionDeformation } from '../../deformation/session.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * Record of a transparent item: what a blend draw reads about IT, and nothing that depends on the
 * frame — its world, its indices, its flags, its deformation words, and its surface's record in the
 * material table (`material`, `../material/materialTable.ts`), which holds every value of its
 * surface: a material's edit writes that one record, and no item.
 *
 * These words move only if the scene moves — a matrix shifted, a surface's flags rewritten. A
 * camera that turns changes none of them. That is why they live in a storage buffer indexed by item
 * rank instead of a dynamically offset uniform: nothing left to write per frame, and no bind group
 * per draw.
 *
 * Its fields in one table, in order: the WGSL struct (`BLEND_ITEM_WGSL`), its size
 * (`BLEND_ITEM_WORDS`) and each field's word (`ITEM`), which the writer reads, are all made of it.
 */
const BLEND_ITEM_FIELDS = [
  ['world', 'mat4x4f'],
  ['indexCount', 'u32'],
  ['vertexBase', 'u32'],
  ['flags', 'u32'],
  ['deform', 'u32'],
  ['deformInput', 'u32'],
  ['deformOutput', 'u32'],
  ['material', 'u32'],
] as const
const LAYOUT = fieldLayout('BlendItem', BLEND_ITEM_FIELDS)

/** Each field's first word in the record: constants, read by the writer as literal offsets were. */
const ITEM = LAYOUT.at
export const BLEND_ITEM_WORDS = LAYOUT.words
/** The first word of the record's world matrix, sixteen single-precision words column-major: what
 *  the water rectangle reads of an item's pose (`../water/rectWgsl.ts`). */
export const BLEND_ITEM_WORLD = ITEM.world

/** Atlas tables the record cites: each texture's slot, per atlas, and the atlases; the session's
 *  GPU deformation, whose record a paged item of a deformed placement names (#357); the material
 *  table, whose record of its surface it names (`../material/materialTable.ts`), and the float
 *  pool's blocks, which say whether a pooled geometry carries a second UV set. */
type BlendAtlasTables = MaterialLayers & {
  deformation?: Pick<SessionDeformation, 'wordOfWorld'>
  materialTable: Pick<MaterialTable, 'surface'>
  geometryBlocks?: ReadonlyMap<HostAttributes, GeometryBlock>
}

/** The flag bits below an item's water rank: a page row's flags of its surface and its geometry
 *  (`rowFlags`), the bits above them — model, fog, sprite, line — being its record's to read. */
const ROW_BITS = (1 << WATER_RANK_SHIFT) - 1

/** Whether the floats `item` reads carry a second UV set where `vertUv1` finds it: its own normal
 *  atlas's tail (`buffers.ts`), or the float pool's for a pooled or a paged unquantized geometry. A
 *  quantized page says so in its own header. */
const floatSecondUv = (item: BlendGpuItem, blocks?: ReadonlyMap<HostAttributes, GeometryBlock>) =>
  item.ownUv1 ?? !!blocks?.get(item.sourceGeometry.attributes)?.hasUv1

/** Writes an item's record at its rank. `floats` and `ints` are two views of the same buffer.
 *  Returns whether its surface carries a lobe. */
export function writeBlendItemRecord(
  floats: Float32Array,
  ints: Uint32Array,
  index: number,
  item: BlendGpuItem,
  tables: BlendAtlasTables,
) {
  const base = index * BLEND_ITEM_WORDS,
    // Read as its owner wrote it last: a surface rewritten in place is read here (#335).
    mat = item.surface,
    lobed = hasPhysicalLobes(mat)
  floats.set(item.matrix.elements, base + ITEM.world)
  // Where the instance reads what it draws, it takes it from the expanded list; the record
  // carries only what belongs to the item — its indices, first vertex, flags.
  ints[base + ITEM.indexCount] = item.count
  ints[base + ITEM.vertexBase] = item.vertexBase ?? 0
  // What the table holds of its surface, written first where it moved: its record and summary.
  const seen = tables.materialTable.surface(mat, tables)
  ints[base + ITEM.flags] =
    item.flags | (rowFlags(seen.row, item.geometry, tables.textures).flags & ROW_BITS)
  // The deformation record of its placement (`PageInfo.deform`): a paged item reads the float
  // pool that holds it; an unpaged one reads buffers of its own, and none.
  ints[base + ITEM.deformInput] = item.deformInput ?? 0
  ints[base + ITEM.deformOutput] = item.deformOutput ?? 0
  ints[base + ITEM.deform] =
    item.paged || item.deformOutput ? (tables.deformation?.wordOfWorld(item.matrix) ?? 0) : 0
  // Its surface's record (`../material/materialTable.ts`), the opaque rows' table.
  ints[base + ITEM.material] = materialWord(seen.rank, floatSecondUv(item, tables.geometryBlocks))
  return lobed
}

/** WGSL declaration of the record, made of its table (`BLEND_ITEM_FIELDS`). */
export const BLEND_ITEM_WGSL = wgslBlock('BLEND_ITEM_WGSL', [], LAYOUT.wgsl)
