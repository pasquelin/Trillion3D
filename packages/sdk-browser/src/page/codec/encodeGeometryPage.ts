import type { SdkWasm } from '../../wasm/sdkWasm.ts'
import { reserveArena, takeHeld } from '../../wasm/wasmArena.ts'
import { META, META_WORDS, REQUEST, REQUEST_WORDS } from '../../wasm/encodeAbi.ts'
import { UV_EXPONENT } from '../../../../sdk-core/src/page/format.ts'
import { isSkinJoint } from '../../../../sdk-core/src/page/pageInput.ts'
import type {
  PageAttribute,
  PageAttributes,
  PageTarget,
} from '../../../../sdk-core/src/page/pageInput.ts'

/**
 * The `WGP3` page encoder of the SDK module (`packages/page-codec-wasm/src/encode.rs`), the one the
 * native compiler writes every cooked page with: the run-time cut calls it through `encode_page`
 * (`wasm_encode.rs`) and gets the page the compiler would write for the same triangles and grids.
 * Source indices and `{ array, itemSize }` attributes (`POSITION` required) go in; the bytes and the
 * counts a manifest records come out. Corners are renumbered by first use, vertices on the same
 * cells kept once, positions once each when that is smaller; texture coordinates sit on
 * `2 ** uvExponent`, positions on `2 ** positionExponent`, which the header carries for every
 * decoder. A page the encoder refuses throws its code (`INVALID_PAGE`, `PAGE_ATTRIBUTE_RANGE`...).
 */

/** The page's SDK module memory is shared by all callers; a refusal to reserve it is an error. */
const memoryRefused = () => new Error('PAGE_ENCODER_MEMORY')

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

/** Encodes one page: `module` is the SDK WebAssembly module (`prepareSdkWasm`). */
export function encodeGeometryPage(
  module: SdkWasm,
  sourceIndices: ArrayLike<number>,
  attributes: PageAttributes,
  positionExponent = -16,
  uvExponent = UV_EXPONENT,
  targets: readonly PageTarget[] = [],
) {
  const position = attributes.POSITION
  if (!position || position.itemSize !== 3 || !position.array.length)
    throw new Error('INVALID_PAGE')
  const vertices = position.array.length / 3
  const skin = skinOf(attributes, vertices)
  const optional = (name: 'NORMAL' | 'TEXCOORD_0' | 'TEXCOORD_1' | 'COLOR_0', widths: number[]) => {
    const attribute: PageAttribute | undefined = attributes[name]
    if (!attribute) return null
    if (
      !widths.includes(attribute.itemSize) ||
      attribute.array.length !== vertices * attribute.itemSize
    )
      throw new Error('INVALID_PAGE_ATTRIBUTE')
    return attribute
  }
  const columns = [
    { name: 'indices', type: 'u32', array: sourceIndices, word: REQUEST.INDICES },
    { name: 'positions', type: 'f32', array: position.array, word: REQUEST.POSITIONS },
    { name: 'normals', type: 'f32', array: optional('NORMAL', [3])?.array, word: REQUEST.NORMALS },
    { name: 'uv', type: 'f32', array: optional('TEXCOORD_0', [2])?.array, word: REQUEST.UV0 },
    { name: 'uv1', type: 'f32', array: optional('TEXCOORD_1', [2])?.array, word: REQUEST.UV1 },
    {
      name: 'colors',
      type: 'f32',
      array: optional('COLOR_0', [3, 4])?.array,
      word: REQUEST.COLORS,
    },
    { name: 'joints', type: 'u32', array: skin?.joints, word: REQUEST.JOINTS },
    { name: 'weights', type: 'f32', array: skin?.weights, word: REQUEST.WEIGHTS },
  ] as const
  const present = columns.filter((column) => column.array)
  for (const target of targets) {
    if (target.POSITION.array.length !== vertices * 3) throw new Error('INVALID_PAGE_ATTRIBUTE')
    if (target.NORMAL && target.NORMAL.array.length !== vertices * 3)
      throw new Error('INVALID_PAGE_ATTRIBUTE')
  }
  const sources = [
    ...present.map(({ type, array }) => ({ type, array: array! })),
    ...targets.flatMap((target) => [
      { type: 'f32' as const, array: target.POSITION.array },
      ...(target.NORMAL ? [{ type: 'f32' as const, array: target.NORMAL.array }] : []),
    ]),
  ]
  const arena = reserveArena(module, [
    { type: 'u32', length: REQUEST_WORDS + META_WORDS },
    { type: 'u32', length: targets.length * 2 },
    ...sources.map(({ type, array }) => ({ type, length: array.length })),
  ])
  if (!arena) throw memoryRefused()
  try {
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
    request[REQUEST.POSITION_EXPONENT] = positionExponent
    request[REQUEST.UV_EXPONENT] = uvExponent
    request[REQUEST.INFLUENCES] = skin?.influences ?? 0
    request[REQUEST.TARGET_COUNT] = targets.length
    request[REQUEST.TARGETS] = targets.length ? table.offset : 0
    const status = module.encode_page(head.offset, head.offset + REQUEST_WORDS * 4)
    // The encoder allocates: its memory may have grown and detached the views taken above.
    const answer = arena.blocks()[0].view as Uint32Array
    const meta = answer.subarray(REQUEST_WORDS, REQUEST_WORDS + META_WORDS)
    if (status !== 0) {
      const bytes = new Uint8Array(meta.buffer, meta.byteOffset + 4, meta[0])
      throw new Error(new TextDecoder().decode(bytes))
    }
    const quantizationError = new Float32Array(
      meta.buffer,
      meta.byteOffset + META.QUANTIZATION_ERROR * 4,
      1,
    )[0]
    const result = {
      vertexCount: meta[META.VERTEX_COUNT],
      indexCount: meta[META.INDEX_COUNT],
      flags: meta[META.FLAGS],
      uncompressedBytes: meta[META.DECODED_BYTES],
      quantizationError,
    }
    return { ...result, data: new Uint8Array(takeHeld(module)[0]) }
  } finally {
    arena.freed()
  }
}
