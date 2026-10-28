import type { BlendGpuItem } from './state.ts'
import type { GeometryBlock, MaterialLayers } from '../geometry/rows/page/pageRowMaterial.ts'
import { rowFlags } from '../geometry/rows/surfaceRow.ts'
import { materialWord, type MaterialTable } from '../materials/table/materialTable.ts'
import { hasPhysicalLobes } from '../materials/surface/physicalLobes.ts'
import { channelsOf } from '../materials/table/materialRecord.ts'
import { altSetOf } from '../materials/graph/state.ts'
import { isProgram, programOf } from '../materials/graph/surfaceProgram.ts'
import { SURFACE_MAP_FIELDS } from '../visibility/materialType.ts'
import { RESPONSIVE_BITS, RESPONSIVE_MASK, RESPONSIVE_SHIFT } from '../visibility/types.ts'
import type { SessionDeformation } from '../deformation/session.ts'
import { fieldLayout } from '../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { rowCell, rowDrawnAs } from '../geometry/partition/rowCells.ts'
import { drawnAsHlod, HLOD_INDEX } from '../diagnostic/colors.ts'
import { objectOffsetRow, writeOffsetWords } from '../geometry/rows/page/offsetRow.ts'
import {
  PLACEMENT_HOLDOUT,
  placementStoredChannelsOf,
} from '../geometry/dag/info/placementInfoLayout.ts'
import { readItemBox } from './worlds.ts'
import { translucencyPassCode } from './translucencyPasses.ts'
import { marksResponsive } from './responsive.ts'
import { maskClipValue } from '../materials/graph/maskProgram.ts'
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'

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
  // What the offset of its surface reads of its object (`../geometry/rows/page/offsetRow.ts`): the
  // words a page row carries (`PageInfo.wpo` and the three beside it).
  ['wpo', 'u32'],
  ['wpoDisableSq', 'f32'],
  ['wpoMost', 'f32'],
  ['wpoCentre', 'vec3f'],
  // The clip value of its surface's opacity mask: a layer under it marks its pixels responsive
  // (`blendResponsive`).
  ['opacityClip', 'f32'],
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
  geometryBlocks?: ReadonlyMap<Geometry['attributes'], GeometryBlock>
}

/** The flag bits an item's record keeps of a page row's flags of its surface and its geometry
 *  (`rowFlags`), the bits above them — model, fog, sprite, line — being its record's to read; the
 *  vertex stage keeps the same below the view's (`vertexWgsl.ts`). */
export const ITEM_FLAG_BITS = 0xffff
/** Above them, read by the vertex stage alone, the bits of its surface's responsiveness code
 *  (`RESPONSIVE_SHIFT` of the row's flags): the stage hands them to the fragments
 *  (`TRI_RESPONSIVE_SHIFT`), never into the flags it ORs the view's with. */
export const ITEM_RESPONSIVE_SHIFT = Math.log2(ITEM_FLAG_BITS + 1)
/** Above them, read by the vertex stage alone, one bit: the item's object is held out of the image's alpha
 *  (`Object3D.holdout`), which its layers' holdout reads (`TRI_HOLDOUT_SHIFT`). */
export const ITEM_HOLDOUT = 1 << (ITEM_RESPONSIVE_SHIFT + RESPONSIVE_BITS)
/** Above it, read by the vertex stage alone, the item's object's lighting channels, three bits, stored
 *  (`storedChannelsOf`, `Object3D.lightingChannels`), which its layers' lights are chosen by
 *  (`TRI_LIGHTING_CHANNELS_SHIFT`). */
export const ITEM_CHANNELS_SHIFT = ITEM_RESPONSIVE_SHIFT + RESPONSIVE_BITS + 1
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
const floatSecondUv = (
  item: BlendGpuItem,
  blocks?: ReadonlyMap<Geometry['attributes'], GeometryBlock>,
) => !!blocks?.get(item.sourceGeometry.attributes)?.hasExtraUv

/** What an item's record says of the programs and targets it needs (`writeBlendItemRecord`): the
 *  lobed programs — its surface carries a lobe, or a map reading a UV set past the first —, and the
 *  responsive target — its surface's responsiveness code is not 0 (`blendResponsiveTargets`) —, the lit
 *  programs' test of the lighting channels — its object's are not the default's —, and from
 *  `passShift` its pass of the image (`translucencyPassCode`). */
export const ITEM_NEEDS = { lobed: 1, responsive: 2, channelled: 4, passShift: 3 } as const

/** Whether the graph a surface wears reads a texture set past the first. */
const readsExtraUv = (mat: BlendGpuItem['surface']) => {
  const program = programOf(mat)
  return isProgram(program) && altSetOf(program.compiled.uses.sets) !== 0
}

/** The node an item's object is: where its draw source names one, else its placement's. */
const itemNode = (item: BlendGpuItem) =>
  item.drawSource?.node ?? item.placement?.rows.sources?.[item.placement.index] ?? undefined

const itemBox = new Float64Array(6)
/** The centre and the surface's facts of the item being written, refilled by each: a scene's records
 *  allocate neither. */
const itemCentre: [number, number, number] = [0, 0, 0]
const itemFacts = { most: 0, always: false }

/** The row of an item's object: its node's switches (read once, `objectBits` of them with the offset words'), the centre
 *  of its local box and what its surface asks of the offset; the row's centre and facts are scratch, good until the next
 *  item's. */
function itemOffsetRow(item: BlendGpuItem) {
  const mat = item.surface,
    node = itemNode(item)
  itemCentre[0] = itemCentre[1] = itemCentre[2] = 0
  if (readItemBox(item, itemBox, 0))
    for (let a = 0; a < 3; a++) itemCentre[a] = (itemBox[a]! + itemBox[3 + a]!) / 2
  itemFacts.most = Math.max(mat.maxWorldPositionOffset ?? 0, 0)
  itemFacts.always = mat.alwaysEvaluateWorldPositionOffset === true
  return objectOffsetRow(node, itemCentre, itemFacts)
}

/** Whether the programs that draw a surface are the lobed ones: it carries a lobe, a map that reads a UV set past the first, or a graph that reads one. */
export const lobedSurface = (mat: BlendGpuItem['surface']) =>
  hasPhysicalLobes(mat) || channelsOf(mat, SURFACE_MAP_FIELDS) !== 0 || readsExtraUv(mat)

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
    // The lobed programs carry a UV set past the first (`vertexWgsl.ts`): a lobe's maps, every
    // map that reads one (glTF's `texCoord`) and a graph that reads one are read there.
    lobed = lobedSurface(mat)
  floats.set(item.matrix.elements, base + ITEM.world)
  // Where the instance reads what it draws, it takes it from the expanded list; the record
  // carries only what belongs to the item — its first vertex, flags.
  ints[base + ITEM.vertexBase] = item.vertexBase ?? 0
  // What the table holds of its surface, written first where it moved: its record and summary.
  const seen = tables.materialTable.surface(mat, tables)
  const { flags } = rowFlags(seen.row, item.geometry, tables.textures)
  // The code its layers write into the responsive target (`marksResponsive`).
  const responsiveCode = marksResponsive(mat) ? (flags >>> RESPONSIVE_SHIFT) & RESPONSIVE_MASK : 0
  const offset = itemOffsetRow(item)
  const channels = placementStoredChannelsOf(offset.bits)
  ints[base + ITEM.flags] =
    item.flags |
    (flags & ITEM_FLAG_BITS) |
    (responsiveCode << ITEM_RESPONSIVE_SHIFT) |
    (offset.bits & PLACEMENT_HOLDOUT ? ITEM_HOLDOUT : 0) |
    (channels << ITEM_CHANNELS_SHIFT) |
    itemHlodBits(item)
  // The deformation record of its placement (`PageInfo.deform`), in the float pool that holds it.
  ints[base + ITEM.deform] = tables.deformation?.wordOfWorld(item.matrix) ?? 0
  // Its surface's record (`../materials/table/materialTable.ts`), the opaque rows' table.
  ints[base + ITEM.material] = materialWord(seen.rank, floatSecondUv(item, tables.geometryBlocks))
  writeOffsetWords(ints, floats, ITEM, base, seen.row, offset)
  for (let a = 0; a < 3; a++) floats[base + ITEM.wpoCentre + a] = offset.centre[a]!
  const pass = translucencyPassCode(mat.translucencyPass)
  floats[base + ITEM.opacityClip] = maskClipValue(mat)
  return (
    (lobed ? ITEM_NEEDS.lobed : 0) |
    (responsiveCode ? ITEM_NEEDS.responsive : 0) |
    (channels ? ITEM_NEEDS.channelled : 0) |
    (pass << ITEM_NEEDS.passShift)
  )
}

/** WGSL declaration of the record, made of its table (`BLEND_ITEM_FIELDS`). */
export const BLEND_ITEM_WGSL = wgslBlock('BLEND_ITEM_WGSL', [], LAYOUT.wgsl)
