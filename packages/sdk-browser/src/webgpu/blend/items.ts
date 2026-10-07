import type { BlendGpuItem } from './state.ts'
import { refreshSurface } from '../../page/surface.ts'
import {
  layerSlot,
  physicalSampledFlag,
  sampledFlag,
  type GeometryBlock,
  type MaterialLayers,
} from '../row/pageRowMaterial.ts'
import { physicalWord, type PhysicalTable } from '../visibility/physicalTable.ts'
import { hasPhysicalLobes } from '../../scene/physicalLobes.ts'
import type { HostAttributes } from '../../host/resources.ts'
import { writeSpriteWords } from '../../visibility/shader/spriteWgsl.ts'
import { FLAG_HAS_TANGENT, frameNormalScaleY } from '../../visibility/buffer.ts'
import { FOG_FREE_MODEL_BIT } from '../../scene/surfaceModel.ts'
import type { SessionDeformation } from '../../deformation/session.ts'
import { fieldLayout } from './fieldLayout.ts'

/**
 * Record of a transparent item: everything a blend draw reads about IT, and nothing that
 * depends on the frame.
 *
 * These words move only if the scene moves — a matrix shifted, a material rewritten. A camera
 * that turns changes none of them. That is why they live in a storage buffer indexed by item
 * rank instead of a dynamically offset uniform: nothing left to write per frame, and no bind
 * group per draw.
 *
 * Its fields in one table, in order: the WGSL struct (`BLEND_ITEM_WGSL`), its size
 * (`BLEND_ITEM_WORDS`) and each field's word (`ITEM`), which the writer reads, are all made of it.
 * Some lanes carry more than their name: `emissive.w` the model and the fog opt-out, `subsurface.w`
 * the subsurface map's slot.
 */
const BLEND_ITEM_FIELDS = [
  ['world', 'mat4x4f'],
  ['color', 'vec4f'],
  ['indexCount', 'u32'],
  ['vertexBase', 'u32'],
  ['flags', 'u32'],
  ['mapIndex', 'u32'],
  ['emissiveIndex', 'u32'],
  ['lineWidth', 'f32'],
  ['alphaTest', 'f32'],
  ['aoIntensity', 'f32'],
  ['roughness', 'f32'],
  ['metalness', 'f32'],
  ['normalScale', 'vec2f'],
  ['roughIndex', 'u32'],
  ['metalIndex', 'u32'],
  ['normalIndex', 'u32'],
  ['aoIndex', 'u32'],
  ['emissive', 'vec4f'],
  ['dash', 'vec2f'],
  ['sprite', 'vec2f'],
  ['subsurface', 'vec4f'],
  ['deform', 'u32'],
  ['deformInput', 'u32'],
  ['deformOutput', 'u32'],
  ['physical', 'u32'],
] as const
const LAYOUT = fieldLayout('BlendItem', BLEND_ITEM_FIELDS)

/** Each field's first word in the record: constants, read by the writer as literal offsets were. */
export const ITEM = LAYOUT.at
export const BLEND_ITEM_WORDS = LAYOUT.words

/** Atlas tables the record cites: each texture's slot, per atlas, and the atlases; the session's
 *  GPU deformation, whose record a paged item of a deformed placement names (#357); the physical
 *  records, which a lobed surface names (`../visibility/physicalTable.ts`), and the float pool's blocks,
 *  which say whether a pooled geometry carries a second UV set. */
type BlendAtlasTables = MaterialLayers & {
  deformation?: Pick<SessionDeformation, 'wordOfWorld'>
  physicalTable?: Pick<PhysicalTable, 'rowWord'>
  geometryBlocks?: ReadonlyMap<HostAttributes, GeometryBlock>
}

/** Whether the floats `item` reads carry a second UV set where `vertUv1` finds it: its own normal
 *  atlas's tail (`buffers.ts`), or the float pool's for a pooled or a paged unquantized geometry. A
 *  quantized page says so in its own header. */
const floatSecondUv = (item: BlendGpuItem, blocks?: ReadonlyMap<HostAttributes, GeometryBlock>) =>
  item.ownUv1 ?? !!blocks?.get(item.sourceGeometry.attributes)?.hasUv1

/** Writes an item's record at its rank. `floats` and `ints` are two views of the same buffer.
 *  Returns its physical word: not zero for a surface that carries a lobe. */
export function writeBlendItemRecord(
  floats: Float32Array,
  ints: Uint32Array,
  index: number,
  item: BlendGpuItem,
  tables: BlendAtlasTables,
) {
  const base = index * BLEND_ITEM_WORDS,
    // Read as the host holds it now: a surface rewritten in place is refilled here (#335).
    mat = refreshSurface(item.surface)
  floats.set(item.matrix.elements, base + ITEM.world)
  floats[base + ITEM.color] = mat.baseColor[0]
  floats[base + ITEM.color + 1] = mat.baseColor[1]
  floats[base + ITEM.color + 2] = mat.baseColor[2]
  floats[base + ITEM.color + 3] = mat.opacity
  // Where the instance reads what it draws, it takes it from the expanded list; the record
  // carries only what belongs to the item — its indices, first vertex, flags, maps.
  ints[base + ITEM.indexCount] = item.count
  ints[base + ITEM.vertexBase] = item.vertexBase ?? 0
  const lobed = writeMaterialWords(floats, ints, base, item, mat, tables)
  // The deformation record of its placement (`PageInfo.deform`): a paged item reads the float
  // pool that holds it; an unpaged one reads buffers of its own, and none.
  ints[base + ITEM.deformInput] = item.deformInput ?? 0
  ints[base + ITEM.deformOutput] = item.deformOutput ?? 0
  ints[base + ITEM.deform] =
    item.paged || item.deformOutput ? (tables.deformation?.wordOfWorld(item.matrix) ?? 0) : 0
  // Its anisotropic and clear-coat record (`physicalWgsl.ts`), the opaque rows' table.
  const physical = lobed
    ? physicalWord(
        tables.physicalTable?.rowWord(mat, tables.dataLayer) ?? 0,
        floatSecondUv(item, tables.geometryBlocks),
      )
    : 0
  ints[base + ITEM.physical] = physical
  return physical
}

/** The material's words of the record at `base`: its flags, maps and factors. Returns whether the
 *  surface carries a lobe. */
function writeMaterialWords(
  floats: Float32Array,
  ints: Uint32Array,
  base: number,
  item: BlendGpuItem,
  mat: ReturnType<typeof refreshSurface>,
  tables: BlendAtlasTables,
) {
  const layer = layerSlot(tables.mapLayer, mat.map),
    emissive = layerSlot(tables.mapLayer, mat.emissiveMap),
    rough = layerSlot(tables.dataLayer, mat.roughnessMap),
    metal = layerSlot(tables.dataLayer, mat.metalnessMap),
    normal = layerSlot(tables.dataLayer, mat.normalMap),
    ao = layerSlot(tables.dataLayer, mat.aoMap),
    subsurface = layerSlot(tables.mapLayer, mat.subsurfaceMap)
  const lobed = hasPhysicalLobes(mat)
  ints[base + ITEM.flags] =
    item.flags |
    sampledFlag(tables.textures, layer, emissive, rough, metal, normal, ao, subsurface) |
    (lobed ? physicalSampledFlag(mat, tables) : 0)
  ints[base + ITEM.mapIndex] = layer
  ints[base + ITEM.emissiveIndex] = emissive
  floats[base + ITEM.lineWidth] = mat.lineWidth ?? 0
  floats[base + ITEM.alphaTest] = mat.alphaTest
  floats[base + ITEM.aoIntensity] = mat.aoIntensity
  floats[base + ITEM.roughness] = mat.roughness
  floats[base + ITEM.metalness] = mat.metalness
  floats[base + ITEM.normalScale] = mat.normalScale
  floats[base + ITEM.normalScale + 1] = frameNormalScaleY(
    mat,
    (item.flags & FLAG_HAS_TANGENT) !== 0,
  )
  ints[base + ITEM.roughIndex] = rough
  ints[base + ITEM.metalIndex] = metal
  ints[base + ITEM.normalIndex] = normal
  ints[base + ITEM.aoIndex] = ao
  floats[base + ITEM.emissive] = mat.emissive[0]
  floats[base + ITEM.emissive + 1] = mat.emissive[1]
  floats[base + ITEM.emissive + 2] = mat.emissive[2]
  // Unused emissive lane carries the model and fog opt-out without growing the record.
  floats[base + ITEM.emissive + 3] = (mat.model ?? 0) | (mat.fog === false ? FOG_FREE_MODEL_BIT : 0)
  // A dashed line's dash and gap (`lineDash`), zero on any other item.
  floats[base + ITEM.dash] = mat.dashSize ?? 0
  floats[base + ITEM.dash + 1] = mat.gapSize ?? 0
  // A sprite's turn and size rule (`spriteAt`), zero on any other item.
  writeSpriteWords(floats, base + ITEM.sprite, mat.sprite)
  floats.set(mat.subsurfaceColor ?? [0, 0, 0], base + ITEM.subsurface)
  // The subsurface colour's unused lane carries its map's slot.
  floats[base + ITEM.subsurface + 3] = subsurface
  return lobed
}

/** WGSL declaration of the record, made of its table (`BLEND_ITEM_FIELDS`). */
export const BLEND_ITEM_WGSL = LAYOUT.wgsl
