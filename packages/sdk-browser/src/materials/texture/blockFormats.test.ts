import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseBlockFormat, poolEncoding, WHITE_TAIL } from './blockFormats.ts'
import type {
  TextureBlockFormat,
  TextureLayout,
} from '../../../../sdk-core/src/texture/previewFormat.ts'

const device = (...names: string[]) => ({ has: (name: string) => names.includes(name) })
const FAMILIES = ['bc7', 'astc', 'etc2'] as const

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
    return { layouts }
  })

// Behaviour: the family is the first the device samples AND the cache holds chains in, under the
// host's choice — BC7 first, which stores every chain, then ASTC, then ETC2 where kept; ETC2 on a
// device that has only it; RGBA8 with a named reason when the device has none of the features,
// when no chain was kept in a gated family it has, or on `'none'`; an explicit family the device
// lacks is refused by name, never swapped in silence.
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
  assert.equal(bc7.laneOf({ layouts }), 'rgba')
  assert.equal(bc7.laneOf({ layouts: { ...layouts, bc7: 'lossless' } }), 'lossless')
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
      bc7.levelFormat('rgba', { layouts }),
      bc7.levelFormat('two-channel', { layouts }),
      bc7.levelFormat('lossless', { layouts }),
    ],
    ['bc7', 'bc5', 'bc7'],
  )
  assert.equal(bc7.fillLane, 'rgba')
  assert.deepEqual([bc7.tapOf('lossless'), bc7.tapOf('rgba'), bc7.tapOf('two-channel')], [0, 1, 2])
  const astc = poolEncoding('astc')
  assert.equal(astc.tapOf('two-channel'), 3)
  assert.equal(astc.laneOf({ layouts }), 'two-channel')
  assert.equal(astc.formatOf('data', 'two-channel'), 'astc-4x4-unorm')
  assert.equal(astc.formatOf('color', 'rgba'), 'astc-4x4-unorm-srgb')
  assert.equal(astc.levelFormat('two-channel', { layouts }), 'astc-la')
  const normal = { layouts: { ...layouts, bc7: 'two-channel' } } as const
  assert.equal(astc.levelFormat('lossless', normal), 'bc5', 'a normal map is stored in BC5')
  const etc2 = poolEncoding('etc2')
  assert.equal(etc2.tapOf('two-channel'), 2, 'EAC RG11 holds Y in its second channel')
  assert.equal(etc2.laneOf({ layouts }), 'two-channel')
  assert.deepEqual(
    [
      etc2.formatOf('color', 'rgba'),
      etc2.formatOf('data', 'rgba'),
      etc2.formatOf('data', 'two-channel'),
    ],
    ['etc2-rgba8unorm-srgb', 'etc2-rgba8unorm', 'eac-rg11unorm'],
  )
  assert.deepEqual(
    [etc2.levelFormat('rgba', { layouts }), etc2.levelFormat('two-channel', { layouts })],
    ['etc2', 'eac-rg'],
  )
  const rgba = poolEncoding(undefined)
  assert.equal(rgba.laneOf({ layouts }), 'lossless')
  assert.deepEqual(
    [
      rgba.formatOf('color', 'lossless'),
      rgba.formatOf('data', 'lossless'),
      rgba.texelBytes('rgba'),
    ],
    ['rgba8unorm-srgb', 'rgba8unorm', 4],
  )
  assert.equal(rgba.levelFormat('lossless', { layouts }), 'bc7')
  assert.equal(rgba.fillLane, 'lossless')
  assert.equal(bc7.tailOf(WHITE_TAIL, 'rgba'), WHITE_TAIL.blocks.bc7)
  assert.equal(bc7.tailOf(WHITE_TAIL, 'lossless'), WHITE_TAIL.levels)
  assert.equal(rgba.tailOf(WHITE_TAIL, 'lossless'), WHITE_TAIL.levels)
  assert.equal(WHITE_TAIL.blocks.astc[0].length, 16)
  assert.equal(etc2.tailOf(WHITE_TAIL, 'rgba'), WHITE_TAIL.blocks.etc2)
  assert.equal(WHITE_TAIL.blocks.etc2[0].length, 16)
})
