import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseBlockFormat, hdrBlocksOf, channelPoolOf, poolEncoding } from './blockFormats.ts'
import {
  PREVIEW_ATLAS_COLOR,
  PREVIEW_ATLAS_DATA,
  PREVIEW_ATLAS_HDR,
  PREVIEW_HALF_FILE,
  type TextureBlockFormat,
  type TextureLayout,
} from '../../../../sdk-core/src/texture/previewFormat.ts'

const device = (...names: string[]) => ({ has: (name: string) => names.includes(name) })
const FAMILIES = ['bc7', 'astc', 'etc2'] as const
const atlas = PREVIEW_ATLAS_COLOR

/** One chain per family, stored in BC as every chain is, and kept in the gated family `kept`
 *  names — two channels there. */
const chains = (...kept: TextureBlockFormat[]) =>
  FAMILIES.map((family) => {
    const layouts: Record<TextureBlockFormat, TextureLayout> = {
      bc7: 'rgba',
      astc: 'lossless',
      etc2: 'lossless',
    }
    if (family !== 'bc7' && kept.includes(family)) layouts[family] = 'two-channel'
    return { layouts, atlas }
  })

// Behaviour: the family is the first the device samples AND the cache holds chains in, under the
// host's choice — BC7 first, which stores every chain, then ASTC, then ETC2 where kept; ETC2 on a
// device that has only it; RGBA8 with a named reason when the device has none of the features,
// when no chain was kept in a gated family it has, or on `'none'`; an explicit family the device
// lacks is refused by name, never swapped in silence.
const SIZE = { width: 4, height: 4, tail: 0 }
/** The white texel of the opaque lane, as the pool's encoding pins it (`PoolEncoding.whiteOf`). */
const WHITE_TAIL = poolEncoding(undefined).whiteOf('lossless')

test('the block format is the one the device samples and the cache holds, with its reason', () => {
  const both = device('texture-compression-bc', 'texture-compression-astc')
  assert.deepEqual(chooseBlockFormat(both, chains('astc')), {
    block: 'bc7',
    reason: 'device has texture-compression-bc, every chain stored in it',
  })
  assert.equal(chooseBlockFormat(device('texture-compression-astc'), chains('astc')).block, 'astc')
  assert.equal(chooseBlockFormat(both, chains('astc'), 'astc').block, 'astc')
  const all = device(
    'texture-compression-bc',
    'texture-compression-astc',
    'texture-compression-etc2',
  )
  assert.equal(chooseBlockFormat(all, chains('astc', 'etc2')).block, 'bc7')
  const mobile = device('texture-compression-astc', 'texture-compression-etc2')
  assert.equal(chooseBlockFormat(mobile, chains('etc2')).block, 'etc2')
  assert.deepEqual(chooseBlockFormat(device('texture-compression-etc2'), chains('etc2')), {
    block: 'etc2',
    reason: 'device has texture-compression-etc2, 1 chains kept in it',
  })
  assert.deepEqual(chooseBlockFormat(mobile, chains()), {
    block: undefined,
    reason: 'the cache holds no chain kept in astc or etc2',
  })
  assert.deepEqual(chooseBlockFormat(device(), chains(), 'auto'), {
    block: undefined,
    reason:
      'device lacks texture-compression-bc and texture-compression-astc and texture-compression-etc2',
  })
  assert.deepEqual(chooseBlockFormat(device('texture-compression-astc'), chains(), 'bc7'), {
    block: undefined,
    reason: 'device lacks texture-compression-bc',
  })
  assert.deepEqual(chooseBlockFormat(both, chains(), 'none'), {
    block: undefined,
    reason: 'host asked for rgba8',
  })
})

// Behaviour: one encoding carries everything a block choice implies — the lane a chain takes
// from its layout word in the chosen family, each lane's pool format (the colour one
// sRGB-decoded, the two-channel one linear), the texel cost, the level file — the stored BC one,
// decoded, in the lossless lane — and which tail is pinned; without a family every chain is
// lossless, RGBA8, and the fill lives there.
test('the pool encoding routes a chain to its lane and names each lane, RGBA8 without a family', () => {
  const layouts = { bc7: 'rgba', astc: 'two-channel', etc2: 'two-channel' } as const
  const bc7 = poolEncoding('bc7')
  assert.equal(bc7.laneOf({ layouts, atlas }), 'rgba')
  assert.equal(bc7.laneOf({ layouts: { ...layouts, bc7: 'lossless' }, atlas }), 'lossless')
  assert.deepEqual(
    [
      bc7.formatOf('color', 'rgba'),
      bc7.formatOf('data', 'rgba'),
      bc7.formatOf('data', 'two-channel'),
    ],
    ['bc7-rgba-unorm-srgb', 'bc7-rgba-unorm', 'bc5-rg-unorm'],
  )
  assert.equal(bc7.formatOf('color', 'lossless'), 'rgba8unorm-srgb')
  assert.deepEqual(
    [bc7.texelBytes('rgba'), bc7.texelBytes('two-channel'), bc7.texelBytes('lossless')],
    [1, 1, 4],
  )
  assert.deepEqual(
    [
      bc7.levelFormat('rgba', { layouts, atlas }),
      bc7.levelFormat('two-channel', { layouts, atlas }),
      bc7.levelFormat('lossless', { layouts, atlas }),
    ],
    ['bc7', 'bc5', 'bc7'],
  )
  assert.equal(bc7.fillLane, 'rgba')
  assert.deepEqual([bc7.tapOf('lossless'), bc7.tapOf('rgba'), bc7.tapOf('two-channel')], [0, 1, 2])
  const astc = poolEncoding('astc')
  assert.equal(astc.tapOf('two-channel'), 3)
  assert.equal(astc.laneOf({ layouts, atlas }), 'two-channel')
  assert.equal(astc.formatOf('data', 'two-channel'), 'astc-4x4-unorm')
  assert.equal(astc.formatOf('color', 'rgba'), 'astc-4x4-unorm-srgb')
  assert.equal(astc.levelFormat('two-channel', { layouts, atlas }), 'astc-la')
  const normal = { layouts: { ...layouts, bc7: 'two-channel' }, atlas } as const
  assert.equal(astc.levelFormat('lossless', normal), 'bc5', 'a normal map is stored in BC5')
  const etc2 = poolEncoding('etc2')
  assert.equal(etc2.tapOf('two-channel'), 2, 'EAC RG11 holds Y in its second channel')
  assert.equal(etc2.laneOf({ layouts, atlas }), 'two-channel')
  assert.deepEqual(
    [
      etc2.formatOf('color', 'rgba'),
      etc2.formatOf('data', 'rgba'),
      etc2.formatOf('data', 'two-channel'),
    ],
    ['etc2-rgba8unorm-srgb', 'etc2-rgba8unorm', 'eac-rg11unorm'],
  )
  assert.deepEqual(
    [
      etc2.levelFormat('rgba', { layouts, atlas }),
      etc2.levelFormat('two-channel', { layouts, atlas }),
    ],
    ['etc2', 'eac-rg'],
  )
  const rgba = poolEncoding(undefined)
  assert.equal(rgba.laneOf({ layouts, atlas }), 'lossless')
  assert.deepEqual(
    [
      rgba.formatOf('color', 'lossless'),
      rgba.formatOf('data', 'lossless'),
      rgba.texelBytes('rgba'),
    ],
    ['rgba8unorm-srgb', 'rgba8unorm', 4],
  )
  assert.equal(rgba.levelFormat('lossless', { layouts, atlas }), 'bc7')
  assert.equal(rgba.fillLane, 'lossless')
  assert.equal(bc7.tailOf(WHITE_TAIL, 'rgba', SIZE), WHITE_TAIL.blocks.bc7)
  assert.equal(bc7.tailOf(WHITE_TAIL, 'lossless', SIZE), WHITE_TAIL.levels)
  assert.equal(rgba.tailOf(WHITE_TAIL, 'lossless', SIZE), WHITE_TAIL.levels)
  assert.equal(WHITE_TAIL.blocks.astc[0].length, 16)
  assert.equal(etc2.tailOf(WHITE_TAIL, 'rgba', SIZE), WHITE_TAIL.blocks.etc2)
  assert.equal(WHITE_TAIL.blocks.etc2[0].length, 16)
  const half = { layouts, atlas: PREVIEW_ATLAS_HDR }
  for (const encoding of [bc7, astc, etc2, rgba]) {
    assert.equal(encoding.laneOf(half), 'hdr', 'a half-float chain takes the half-float lane')
    assert.equal(encoding.formatOf('color', 'hdr'), 'rgba16float')
    assert.equal(encoding.levelFormat('hdr', half), PREVIEW_HALF_FILE)
    assert.equal(encoding.tailOf(WHITE_TAIL, 'hdr', SIZE), WHITE_TAIL.levels)
    assert.equal(encoding.tapOf('hdr'), 4)
  }
})

// Behaviour: a texture's compression setting adds layouts of the stored family: one channel in BC4
// blocks, or kept to the bit in eight-bit blocks (`gray`, `displacement`), all read from the data
// atlas's channel pool — the third binding, where no normal map needs BC5 —: BC4 where the device
// samples BC and every chain of the pool is BC4, else R8 texels, the tail's red channel; with a
// normal map beside them, and in the colour atlas, from the lossless lane; BC6H's half-float chain
// from the half-float lane, whose pool is BC6H only where the device samples BC and every half-float
// chain is stored in it; the level file is each layout's own.
test('one-channel and BC6H chains take the lanes and files of their layouts', () => {
  const block = (
    layout: 'one-channel' | 'rgba' | 'gray' | 'displacement' | 'two-channel',
    hdr = false,
  ) => ({
    layouts: { bc7: hdr ? ('hdr' as const) : layout, astc: 'lossless', etc2: 'lossless' } as const,
    atlas: hdr ? PREVIEW_ATLAS_HDR : PREVIEW_ATLAS_DATA,
  })
  const single = block('one-channel'),
    gray = block('gray'),
    displacement = block('displacement'),
    normal = block('two-channel')
  assert.equal(channelPoolOf('bc7', [single]), 'bc4')
  assert.equal(channelPoolOf('bc7', [single, gray]), 'r8', 'an eight-bit chain keeps R8')
  assert.equal(channelPoolOf('bc7', [single, normal]), 'two', 'a normal map keeps BC5')
  assert.equal(channelPoolOf('bc7', [normal]), 'two')
  assert.equal(channelPoolOf('astc', [single]), 'two', 'a device without BC decodes them')
  assert.equal(channelPoolOf('bc7', [{ ...single, atlas: PREVIEW_ATLAS_COLOR }]), 'two')
  assert.equal(channelPoolOf('bc7', []), 'two')
  const bc7 = poolEncoding('bc7', false, 'bc4')
  assert.equal(bc7.laneOf(single), 'two-channel')
  assert.equal(bc7.laneOf({ ...single, atlas: PREVIEW_ATLAS_COLOR }), 'lossless')
  assert.equal(poolEncoding('bc7').laneOf(single), 'lossless', 'beside a normal map')
  assert.equal(bc7.levelFormat('two-channel', single), 'bc4')
  assert.equal(bc7.levelFormat('lossless', single), 'bc4', 'decoded from its file')
  assert.equal(bc7.formatOf('data', 'two-channel'), 'bc4-r-unorm')
  assert.equal(bc7.texelBytes('two-channel'), 0.5)
  const tail = {
    levels: [Uint8Array.of(9, 0, 0, 255)],
    blocks: { bc7: [Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)], astc: [], etc2: [] },
    ...single,
  }
  assert.deepEqual([...bc7.tailOf(tail, 'two-channel', SIZE)[0]], [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(
    [...bc7.tailOf(WHITE_TAIL, 'two-channel', SIZE)[0]],
    [255, 255, 0, 0, 0, 0, 0, 0],
  )
  const r8 = poolEncoding('bc7', false, 'r8')
  assert.equal(r8.formatOf('data', 'two-channel'), 'r8unorm')
  assert.equal(r8.texelBytes('two-channel'), 1)
  assert.deepEqual([...r8.tailOf(tail, 'two-channel', SIZE)[0]], [9])
  assert.deepEqual([...r8.tailOf(WHITE_TAIL, 'two-channel', SIZE)[0]], [255])
  assert.deepEqual([r8.laneOf(gray), r8.laneOf(displacement)], ['two-channel', 'two-channel'])
  assert.deepEqual(
    [r8.levelFormat('two-channel', gray), r8.levelFormat('two-channel', displacement)],
    ['g8', 'a8'],
  )
  assert.deepEqual(
    [r8.levelFormat('lossless', gray), r8.levelFormat('lossless', displacement)],
    ['g8', 'a8'],
  )
  assert.deepEqual(
    [single, gray, displacement].map((chain) => r8.tapOf('two-channel', chain.layouts.bc7)),
    [5, 6, 7],
  )
  assert.equal(r8.tapOf('two-channel'), 6, 'the white fill reads as a grey')
  assert.equal(poolEncoding('bc7').tapOf('two-channel'), 2, 'a normal map reads as before')
  const half = block('rgba', true)
  assert.equal(bc7.levelFormat('hdr', half), 'bc6h')
  assert.equal(
    bc7.levelFormat('hdr', { ...half, layouts: { ...half.layouts, bc7: 'lossless' } }),
    PREVIEW_HALF_FILE,
  )
  assert.equal(bc7.formatOf('color', 'hdr'), 'rgba16float')
  assert.equal(poolEncoding('bc7', true).formatOf('color', 'hdr'), 'bc6h-rgb-ufloat')
  assert.equal(poolEncoding('bc7', true).texelBytes('hdr'), 1)
  assert.equal(hdrBlocksOf('bc7', [half]), true)
  assert.equal(hdrBlocksOf('astc', [half]), false, 'a device without BC decodes them')
  assert.equal(
    hdrBlocksOf('bc7', [half, { ...half, layouts: { ...half.layouts, bc7: 'lossless' } }]),
    false,
    'one half-float chain keeps the pool in half-floats',
  )
  assert.equal(hdrBlocksOf('bc7', []), false)
})
