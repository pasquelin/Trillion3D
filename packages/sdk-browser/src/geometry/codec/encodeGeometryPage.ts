import { fromF32Bits } from '../../../../math/src/float/bits.ts'
import type { SdkWasm } from '../../wasm/sdkWasm.ts'
import { takeHeld, withArena } from '../../wasm/wasmArena.ts'
import { META, META_WORDS, REQUEST, REQUEST_WORDS } from '../../wasm/encodeAbi.ts'
import { refused } from './geometryPage.ts'
import { isSkinJoint } from '../../../../sdk-core/src/page/pageInput.ts'
import type {
  PageAttribute,
  PageAttributes,
  PageTarget,
} from '../../../../sdk-core/src/page/pageInput.ts'

/**
 * The `WGP3` page encoder of the SDK module (`packages/page-codec-wasm/src/encode.rs`), the one the
 * native compiler writes every cooked page with: the run-time cut calls it through `encode_page`
 * (`wasm/encode.rs`) and gets the page the compiler would write for the same triangles and grids.
 * Source indices and `{ array, itemSize }` attributes (`POSITION` required) go in; the bytes and the
 * counts a manifest records come out. Corners are renumbered by first use, vertices on the same
 * cells kept once, positions once each when that is smaller; positions sit on cells of
 * `2 ** -positionPrecision` centimetre, which the header carries for every decoder, texture
 * coordinates as float codes, colours as bytes, normals and tangents at the format's precisions.
 * Up to eight texture sets, `TEXCOORD_0` to `TEXCOORD_7`. A page the encoder refuses throws its
 * code (`INVALID_PAGE`, `PAGE_ATTRIBUTE_RANGE`...).
 */

/** The texture-set semantics a page carries, in set order, with the request word each is sent in. */
const TEXTURE_SETS = [
  ['TEXCOORD_0', 'uv0', REQUEST.UV0],
  ['TEXCOORD_1', 'uv1', REQUEST.UV1],
  ['TEXCOORD_2', 'uv2', REQUEST.UV2],
  ['TEXCOORD_3', 'uv3', REQUEST.UV3],
  ['TEXCOORD_4', 'uv4', REQUEST.UV4],
  ['TEXCOORD_5', 'uv5', REQUEST.UV5],
  ['TEXCOORD_6', 'uv6', REQUEST.UV6],
  ['TEXCOORD_7', 'uv7', REQUEST.UV7],
] as const

/** The skin of `attributes`, every `JOINTS_n` rank side by side per vertex, or null. */
function skinOf(attributes: PageAttributes, vertices: number) {
  const ranks = Object.keys(attributes)
    .filter((key) => /^(JOINTS|WEIGHTS)_\d+$/.test(key))
    .map((key) => Number(key.split('_')[1]))
  const sets = [...new Set(ranks)]
    .sort((a, b) => a - b)
    .map((rank) => {
      const joints = attributes[`JOINTS_${rank}`],
        weights = attributes[`WEIGHTS_${rank}`]
      if (!joints || !weights || joints.itemSize !== weights.itemSize)
        throw new Error('PAGE_SKIN_ATTRIBUTES')
      return { joints, weights }
    })
  const width = sets.reduce((sum, { joints }) => sum + joints.itemSize, 0)
  if (!width) return null
  if (width > 65536) throw new Error('PAGE_SKIN_ATTRIBUTES')
  const joints = new Uint32Array(vertices * width),
    weights = new Float32Array(vertices * width)
  for (let v = 0; v < vertices; v++) {
    let at = v * width
    for (const set of sets)
      for (let j = 0; j < set.joints.itemSize; j++, at++) {
        const joint = set.joints.array[v * set.joints.itemSize + j]
        if (!isSkinJoint(joint)) throw new Error('PAGE_SKIN_ATTRIBUTES')
        joints[at] = joint
        weights[at] = set.weights.array[v * set.weights.itemSize + j]
      }
  }
  return { joints, weights, influences: width }
}

type Skin = ReturnType<typeof skinOf>

/** The attribute `name` of `attributes`, none when absent; its width one of `widths` and its length
 *  one item a vertex. */
function optionalAttribute(
  attributes: PageAttributes,
  vertices: number,
  name: 'NORMAL' | (typeof TEXTURE_SETS)[number][0] | 'COLOR_0',
  widths: number[],
) {
  const attribute: PageAttribute | undefined = attributes[name]
  if (!attribute) return null
  if (
    !widths.includes(attribute.itemSize) ||
    attribute.array.length !== vertices * attribute.itemSize
  )
    throw new Error('INVALID_PAGE_ATTRIBUTE')
  return attribute
}

/** The columns a page may carry, in the encoder's order, each with the array it has. */
function pageColumns(
  attributes: PageAttributes,
  sourceIndices: ArrayLike<number>,
  position: PageAttribute,
  vertices: number,
  skin: Skin,
) {
  const optional = (
    name: 'NORMAL' | (typeof TEXTURE_SETS)[number][0] | 'COLOR_0',
    widths: number[],
  ) => optionalAttribute(attributes, vertices, name, widths)
  return [
    { name: 'indices', type: 'u32', array: sourceIndices, word: REQUEST.INDICES },
    { name: 'positions', type: 'f32', array: position.array, word: REQUEST.POSITIONS },
    { name: 'normals', type: 'f32', array: optional('NORMAL', [3])?.array, word: REQUEST.NORMALS },
    ...TEXTURE_SETS.map(([semantic, name, word]) => ({
      name,
      type: 'f32' as const,
      array: optional(semantic, [2])?.array,
      word,
    })),
    {
      name: 'colors',
      type: 'f32',
      array: optional('COLOR_0', [3, 4])?.array,
      word: REQUEST.COLORS,
    },
    { name: 'joints', type: 'u32', array: skin?.joints, word: REQUEST.JOINTS },
    { name: 'weights', type: 'f32', array: skin?.weights, word: REQUEST.WEIGHTS },
  ] as const
}

type Columns = ReturnType<typeof pageColumns>

/** The arrays sent to the encoder: the columns present, then each target's positions and normals. */
function pageSources(columns: Columns, targets: readonly PageTarget[], vertices: number) {
  const present = columns.filter((column) => column.array)
  for (const target of targets) {
    if (target.POSITION.array.length !== vertices * 3) throw new Error('INVALID_PAGE_ATTRIBUTE')
    if (target.NORMAL && target.NORMAL.array.length !== vertices * 3)
      throw new Error('INVALID_PAGE_ATTRIBUTE')
  }
  return [
    ...present.map(({ type, array }) => ({ type, array: array! })),
    ...targets.flatMap((target) => [
      { type: 'f32' as const, array: target.POSITION.array },
      ...(target.NORMAL ? [{ type: 'f32' as const, array: target.NORMAL.array }] : []),
    ]),
  ]
}

/** What the encoder returns of a page, read from its answer `meta`. */
function pageResult(meta: Uint32Array) {
  return {
    vertexCount: meta[META.VERTEX_COUNT],
    indexCount: meta[META.INDEX_COUNT],
    flags: meta[META.FLAGS],
    uncompressedBytes: meta[META.DECODED_BYTES],
    // What the page takes in the pool once the install pass has written it.
    residentBytes: meta[META.RESIDENT_BYTES],
    // The box of the positions the page decodes to, its six words from `LOW_X` to `HIGH_Z`: the
    // low corner then the high one, what a view's culling bounds it by.
    min: [0, 1, 2].map((axis) => fromF32Bits(meta[META.LOW_X + axis])),
    max: [2, 1, 0].map((back) => fromF32Bits(meta[META.HIGH_Z - back])),
  }
}

/** Encodes one page: `module` is the SDK WebAssembly module (`requireSdkWasm`). */
export function encodeGeometryPage(
  module: SdkWasm,
  sourceIndices: ArrayLike<number>,
  attributes: PageAttributes,
  positionPrecision = 7,
  targets: readonly PageTarget[] = [],
) {
  const position = attributes.POSITION
  if (!position || position.itemSize !== 3 || !position.array.length)
    throw new Error('INVALID_PAGE')
  const vertices = position.array.length / 3
  const skin = skinOf(attributes, vertices)
  const columns = pageColumns(attributes, sourceIndices, position, vertices, skin)
  const sources = pageSources(columns, targets, vertices)
  const requests = [
    { type: 'u32' as const, length: REQUEST_WORDS + META_WORDS },
    { type: 'u32' as const, length: targets.length * 2 },
    ...sources.map(({ type, array }) => ({ type, length: array.length })),
  ]
  return withArena(module, requests, 'PAGE_ENCODER_MEMORY', (arena) => {
    const [head, table, ...blocks] = arena.blocks()
    const words = head.view as Uint32Array
    const request = words.subarray(0, REQUEST_WORDS)
    sources.forEach(({ array }, i) => blocks[i].view.set(array))
    let next = 0
    for (const column of columns) if (column.array) request[column.word] = blocks[next++].offset
    for (const [t, target] of targets.entries()) {
      ;(table.view as Uint32Array)[t * 2] = blocks[next++].offset
      ;(table.view as Uint32Array)[t * 2 + 1] = target.NORMAL ? blocks[next++].offset : 0
    }
    request[REQUEST.INDEX_COUNT] = sourceIndices.length
    request[REQUEST.VERTEX_COUNT] = vertices
    request[REQUEST.COLOR_WIDTH] = attributes.COLOR_0?.itemSize ?? 0
    request[REQUEST.POSITION_PRECISION] = positionPrecision
    request[REQUEST.INFLUENCES] = skin?.influences ?? 0
    request[REQUEST.TARGET_COUNT] = targets.length
    request[REQUEST.TARGETS] = targets.length ? table.offset : 0
    const status = module.encode_page(head.offset, head.offset + REQUEST_WORDS * 4)
    // The encoder allocates: its memory may have grown and detached the views taken above.
    const answer = arena.blocks()[0].view as Uint32Array
    const meta = answer.subarray(REQUEST_WORDS, REQUEST_WORDS + META_WORDS)
    if (status !== 0) refused(meta)
    return { ...pageResult(meta), data: new Uint8Array(takeHeld(module)[0]) }
  })
}
