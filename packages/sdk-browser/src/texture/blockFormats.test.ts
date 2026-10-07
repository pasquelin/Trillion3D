import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseBlockFormat, poolEncoding, WHITE_TAIL } from './blockFormats.ts'
import type { TextureBlockFormat, TextureLayout } from '../../../sdk-core/src/index.ts'

const device = (...names: string[]) => ({ has: (name: string) => names.includes(name) })
const FAMILIES = ['bc7', 'astc', 'etc2'] as const

/** One chain per family, kept in it alone — RGBA in BC, two channels elsewhere — when `kept`
 *  names it. */
const chains = (...kept: TextureBlockFormat[]) =>
  FAMILIES.map((family) => {
    const layouts: Record<TextureBlockFormat, TextureLayout> = {
      bc7: 'lossless',
      astc: 'lossless',
      etc2: 'lossless',
    }
    if (kept.includes(family)) layouts[family] = family === 'bc7' ? 'rgba' : 'two-channel'
    return { layouts }
  })

// Behaviour: the family is the first the device samples AND the cache holds kept chains in,
// under the host's choice — BC7 first, then ASTC, then ETC2; ASTC on a device with BC when the
// cook wrote ASTC alone; ETC2 on a device that has only it; RGBA8 with a named reason when the
// device has none of the features, when no chain was kept in a family it has, or on `'none'`; an
// explicit family the device lacks is refused by name, never swapped in silence.
test('the block format is the one the device samples and the cache holds, with its reason', () => {
  const both = device('texture-compression-bc', 'texture-compression-astc')
  assert.deepEqual(chooseBlockFormat(both, chains('bc7', 'astc')), {
    block: 'bc7',
    reason: 'device has texture-compression-bc, 1 chains kept in it',
  })
  assert.equal(chooseBlockFormat(both, chains('astc')).block, 'astc')
  assert.equal(chooseBlockFormat(device('texture-compression-astc'), chains('astc')).block, 'astc')
  assert.equal(chooseBlockFormat(both, chains('bc7', 'astc'), 'astc').block, 'astc')
  const all = device(
    'texture-compression-bc',
    'texture-compression-astc',
    'texture-compression-etc2',
  )
  assert.equal(chooseBlockFormat(all, chains('bc7', 'astc', 'etc2')).block, 'bc7')
  assert.equal(chooseBlockFormat(all, chains('etc2')).block, 'etc2')
  assert.deepEqual(chooseBlockFormat(device('texture-compression-etc2'), chains('etc2')), {
    block: 'etc2',
    reason: 'device has texture-compression-etc2, 1 chains kept in it',
  })
  assert.deepEqual(chooseBlockFormat(both, chains()), {
    block: undefined,
    reason: 'the cache holds no chain kept in bc7 or astc',
  })
  assert.deepEqual(chooseBlockFormat(device(), chains('bc7'), 'auto'), {
    block: undefined,
    reason:
      'device lacks texture-compression-bc and texture-compression-astc and texture-compression-etc2',
  })
  assert.deepEqual(chooseBlockFormat(device('texture-compression-astc'), chains('bc7'), 'bc7'), {
    block: undefined,
    reason: 'device lacks texture-compression-bc',
  })
  assert.deepEqual(chooseBlockFormat(both, chains('bc7'), 'none'), {
    block: undefined,
    reason: 'host asked for rgba8',
  })
})

// Behaviour: one encoding carries everything a block choice implies — the lane a chain takes
// from its layout word in the chosen family, each lane's pool format (the colour one
// sRGB-decoded, the two-channel one linear), the texel cost, the level file and which tail is
// pinned; without a family every chain is lossless, RGBA8, and the fill lives there.
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
    [bc7.levelFormat('rgba'), bc7.levelFormat('two-channel'), bc7.levelFormat('lossless')],
    ['bc7', 'bc5', 'png'],
  )
  assert.equal(bc7.fillLane, 'rgba')
  assert.deepEqual([bc7.tapOf('lossless'), bc7.tapOf('rgba'), bc7.tapOf('two-channel')], [0, 1, 2])
  const astc = poolEncoding('astc')
  assert.equal(astc.tapOf('two-channel'), 3)
  assert.equal(astc.laneOf({ layouts }), 'two-channel')
  assert.equal(astc.formatOf('data', 'two-channel'), 'astc-4x4-unorm')
  assert.equal(astc.formatOf('color', 'rgba'), 'astc-4x4-unorm-srgb')
  assert.equal(astc.levelFormat('two-channel'), 'astc-la')
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
  assert.deepEqual([etc2.levelFormat('rgba'), etc2.levelFormat('two-channel')], ['etc2', 'eac-rg'])
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
  assert.equal(rgba.levelFormat('lossless'), 'png')
  assert.equal(rgba.fillLane, 'lossless')
  assert.equal(bc7.tailOf(WHITE_TAIL, 'rgba'), WHITE_TAIL.blocks.bc7)
  assert.equal(bc7.tailOf(WHITE_TAIL, 'lossless'), WHITE_TAIL.levels)
  assert.equal(rgba.tailOf(WHITE_TAIL, 'lossless'), WHITE_TAIL.levels)
  assert.equal(WHITE_TAIL.blocks.astc[0].length, 16)
  assert.equal(etc2.tailOf(WHITE_TAIL, 'rgba'), WHITE_TAIL.blocks.etc2)
  assert.equal(WHITE_TAIL.blocks.etc2[0].length, 16)
})
