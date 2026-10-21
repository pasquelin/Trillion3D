import type { BlendGpuItem } from './state.ts'
import type { GeometryBlock, MaterialLayers } from '../geometry/rows/page/pageRowMaterial.ts'
import { rowFlags } from '../geometry/rows/surfaceRow.ts'
import { materialWord, type MaterialTable } from '../materials/table/materialTable.ts'
import { hasPhysicalLobes } from '../materials/surface/physicalLobes.ts'
import { channelsOf } from '../materials/table/materialRecord.ts'
import { SURFACE_MAP_FIELDS } from '../visibility/materialType.ts'
import { HISTORY_SHARE_MASK, HISTORY_SHARE_SHIFT } from '../visibility/types.ts'
import type { HostAttributes } from '../session/host/resources.ts'
import type { SessionDeformation } from '../deformation/session.ts'
import { fieldLayout } from '../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { rowCell, rowDrawnAs } from '../geometry/partition/rowCells.ts'
import { drawnAsHlod, HLOD_INDEX } from '../diagnostic/colors.ts'

/**
 * Record of a transparent item: what a blend draw reads about IT, and nothing that depends on the
 * frame — its world, its first float vertex, its flags, its deformation word, and its surface's
 * record in the material table (`material`, `../materials/table/materialTable.ts`), which holds every
 * value of its surface: a material's edit writes that one record, and no item.
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
  ['vertexBase', 'u32'],
  ['flags', 'u32'],
  ['deform', 'u32'],
  ['material', 'u32'],
] as const
const LAYOUT = fieldLayout('BlendItem', BLEND_ITEM_FIELDS)

/** Each field's first word in the record: constants, read by the writer as literal offsets were. */
const ITEM = LAYOUT.at
export const BLEND_ITEM_WORDS = LAYOUT.words
/** The flags' word in a record. */
export const ITEM_FLAGS_WORD = ITEM.flags

/** Atlas tables the record cites: each texture's slot, per atlas, and the atlases; the session's
 *  GPU deformation, whose record an item of a deformed placement names (#357); the material
 *  table, whose record of its surface it names (`../materials/table/materialTable.ts`), and the float
 *  pool's blocks, which say whether a float geometry carries a second UV set. */
type BlendAtlasTables = MaterialLayers & {
  deformation?: Pick<SessionDeformation, 'wordOfWorld'>
  materialTable: Pick<MaterialTable, 'surface'>
  geometryBlocks?: ReadonlyMap<HostAttributes, GeometryBlock>
}

/** The flag bits an item's record keeps of a page row's flags of its surface and its geometry
 *  (`rowFlags`), the bits above them — model, fog, sprite, line — being its record's to read; the
 *  vertex stage keeps the same below the view's (`vertexWgsl.ts`). */
export const ITEM_FLAG_BITS = 0xffff
/** Above them, read by the vertex stage alone, the four bits of its surface's history share code
 *  (`HISTORY_SHARE_SHIFT` of the row's flags), here from bit 16: the stage hands them to the
 *  fragments (`TRI_GIVEN_UP_SHIFT`), never into the flags it ORs the view's with. */
export const ITEM_HISTORY_SHIFT = 16
/** Above them, read by the vertex stage alone, from bit 28: the HLOD index its placement draws as
 *  (`drawnAsHlod`, `none` itself) — its cell's HLOD 0 actor (`RowCell.proxy`), an instanced actor
 *  for a row of it (`RowCell.actor`) —, which the HLOD view colours (`diagnosticDrawnAs`), as a
 *  page row's word says (`pageDiagnosticWord`). Written with the record, and again with the poses
 *  (`sceneRefresh.ts`). */
export const ITEM_HLOD = { shift: 28, mask: 0xf } as const

/** The item's `ITEM_HLOD` bits, as its row's cell says now. */
export const itemHlodBits = ({ placement }: Pick<BlendGpuItem, 'placement'>) => {
  const drawnAs = rowDrawnAs(placement && rowCell(placement.rows, placement.index))
  return (drawnAsHlod(HLOD_INDEX.none, drawnAs) << ITEM_HLOD.shift) >>> 0
}

/** Whether the floats `item` reads carry a second UV set where `vertUv1` finds it: the float
 *  pool's, for a geometry its pages carry unquantized. A quantized page says so in its own
 *  header. */
const floatSecondUv = (item: BlendGpuItem, blocks?: ReadonlyMap<HostAttributes, GeometryBlock>) =>
  !!blocks?.get(item.sourceGeometry.attributes)?.hasExtraUv

/** What an item's record says of the programs and targets it needs (`writeBlendItemRecord`): the
 *  lobed programs — its surface carries a lobe, or a map reading a UV set past the first —, and the
 *  history given up — its surface's history share code is not 0 (`blendShareTargets`). */
export const ITEM_NEEDS = { lobed: 1, givesUp: 2 } as const

/** Writes an item's record at its rank. `floats` and `ints` are two views of the same buffer.
 *  Returns what it needs (`ITEM_NEEDS` bits). */
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
    // The lobed programs carry a UV set past the first (`vertexWgsl.ts`): a lobe's maps, and every
    // map that reads one (glTF's `texCoord`), are read there.
    lobed = hasPhysicalLobes(mat) || channelsOf(mat, SURFACE_MAP_FIELDS) !== 0
  floats.set(item.matrix.elements, base + ITEM.world)
  // Where the instance reads what it draws, it takes it from the expanded list; the record
  // carries only what belongs to the item — its first vertex, flags.
  ints[base + ITEM.vertexBase] = item.vertexBase ?? 0
  // What the table holds of its surface, written first where it moved: its record and summary.
  const seen = tables.materialTable.surface(mat, tables)
  const { flags } = rowFlags(seen.row, item.geometry, tables.textures)
  const historyCode = (flags >>> HISTORY_SHARE_SHIFT) & HISTORY_SHARE_MASK
  ints[base + ITEM.flags] =
    item.flags | (flags & ITEM_FLAG_BITS) | (historyCode << ITEM_HISTORY_SHIFT) | itemHlodBits(item)
  // The deformation record of its placement (`PageInfo.deform`), in the float pool that holds it.
  ints[base + ITEM.deform] = tables.deformation?.wordOfWorld(item.matrix) ?? 0
  // Its surface's record (`../materials/table/materialTable.ts`), the opaque rows' table.
  ints[base + ITEM.material] = materialWord(seen.rank, floatSecondUv(item, tables.geometryBlocks))
  return (lobed ? ITEM_NEEDS.lobed : 0) | (historyCode ? ITEM_NEEDS.givesUp : 0)
}

/** WGSL declaration of the record, made of its table (`BLEND_ITEM_FIELDS`). */
export const BLEND_ITEM_WGSL = wgslBlock('BLEND_ITEM_WGSL', [], LAYOUT.wgsl)
