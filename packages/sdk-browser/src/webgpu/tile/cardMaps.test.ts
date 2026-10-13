// #1527: the impostor maps are textures of the tile catalogue, appended at prepare after the
// scene's: colour and coverage to the colour atlas, normal and depth and ORM to the data atlas, each
// level its own file, the chain laid out down to its last level — frames of four texels, never one
// texel. Fails on the old code: the maps were textures of their own, outside the catalogue.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ImpostorSection } from '../../../../sdk-core/src/index.ts'
import { appendCardMaps } from './cardMaps.ts'
import type { TileTexture } from './tileTexture.ts'

/** A map of `sides` levels, square, each its own file. */
const mapOf = (name: string, sides: number[]) => ({
  kind: 'data',
  levels: sides.map((side, level) => ({
    url: `${name}${level}.png`,
    sha256: `${name}${level}`.padEnd(64, '0'),
    bytes: side * side,
    width: side,
    height: side,
  })),
})

/** A section of baked meshes `meshes`, each with its levels' sides. */
const sectionOf = (meshes: Array<[number, number[]]>) =>
  ({
    meshes: meshes.map(([mesh, sides]) => ({
      mesh,
      status: 'baked',
      frames: 12,
      frameSide: 64,
      maps: {
        colourCoverage: mapOf(`c${mesh}`, sides),
        normalDepth: mapOf(`n${mesh}`, sides),
        orm: mapOf(`o${mesh}`, sides),
      },
    })),
  }) as unknown as ImpostorSection

test('each baked mesh’s three maps are appended, its chain laid out down to its last level', () => {
  const color = [{} as TileTexture],
    data = [{} as TileTexture, {} as TileTexture]
  const refused: string[] = []
  const slots = appendCardMaps(
    sectionOf([
      [3, [768, 384, 192, 96, 48]],
      [4, [384, 192, 96, 48]],
    ]),
    color,
    data,
    (phase) => refused.push(phase),
  )
  assert.deepEqual(
    [...slots],
    [
      [3, [1, 2, 3]],
      [4, [2, 4, 5]],
    ],
  )
  assert.deepEqual(refused, [])
  const [, colour] = color
  assert.equal(colour.lane, 'lossless')
  assert.deepEqual([colour.layout.width, colour.layout.tail, colour.layout.last], [768, 4, 4])
  assert.equal(colour.source.kind, 'files')
  if (colour.source.kind === 'files')
    assert.deepEqual(
      colour.source.levels.map((level) => level.url),
      ['c30.png', 'c31.png', 'c32.png', 'c33.png', 'c34.png'],
      'each level at its own file, read as the manifest names it',
    )
  assert.equal(data.length, 6)
})

test('a chain that stops before its tail is refused by name and leaves its mesh to its clusters', () => {
  const color: TileTexture[] = [],
    data: TileTexture[] = []
  const refused: string[] = []
  const slots = appendCardMaps(sectionOf([[3, [1024, 512]]]), color, data, (phase, error) =>
    refused.push(`${phase}: ${(error as Error).message}`),
  )
  assert.equal(slots.size, 0)
  assert.deepEqual(refused, ['impostor-maps-refused 3: TEXTURE_CHAIN_BEFORE_TAIL'])
  assert.deepEqual([color.length, data.length], [0, 0])
})
