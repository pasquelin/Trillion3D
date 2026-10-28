// A texture lists as siblings the maps of its stack of its aspect, any size, each by the bias of the sizes
// (`materials/virtual/stacks.ts`), the cap taken after the maps of another aspect are left out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { stackTextures } from './textureStack.ts'
import {
  SIBLING_CAP,
  SIBLING_DATA,
  siblingRef,
  siblingWord,
} from '../../materials/virtual/page/pageTable.ts'
import { siblingWords, type SiblingSets } from '../../materials/virtual/stacks.ts'
import type { TileTexture } from '../../materials/virtual/tileTexture.ts'

const sized = (width: number, height = width) => ({ layout: { width, height } }) as TileTexture
const dataRef = (slot: number) => siblingRef('data', slot)

test('the siblings of a stack are listed in either atlas, each by the bias of the sizes', () => {
  const color = [sized(1), sized(2048), sized(2048), sized(1024)]
  const data = [sized(1), sized(2048), sized(512)]
  const siblings: SiblingSets = {
    color: [undefined as never, new Set([2, 3, dataRef(1), dataRef(2)])],
    data: [],
  }
  stackTextures({ color, data }, siblings)
  assert.deepEqual(color[1].siblings, [
    siblingWord(2, 0),
    siblingWord(3, 1),
    siblingWord(dataRef(1), 0),
    siblingWord(dataRef(2), 2),
  ])
  assert.deepEqual(color[2].siblings, [], 'a texture no stack lists has none, whatever it listed')
})

test('a map of another aspect is left out; the cap is taken after', () => {
  const color = [sized(1), sized(2048), ...Array.from({ length: 12 }, () => sized(2048))]
  const data = [sized(1), ...Array.from({ length: 4 }, () => sized(2048, 1024))]
  const siblings: SiblingSets = {
    color: [
      undefined as never,
      new Set([1, 2, 3, 4].map(dataRef).concat(Array.from({ length: 12 }, (_, i) => i + 2))),
    ],
    data: [],
  }
  stackTextures({ color, data }, siblings)
  assert.equal(color[1].siblings?.length, SIBLING_CAP)
  assert.ok(
    color[1].siblings!.every((word) => (word & SIBLING_DATA) === 0),
    'only the ones of its aspect',
  )
})

test('a sibling larger than the texture is listed by a negative bias', () => {
  const atlases = { color: [sized(1), sized(512), sized(2048)], data: [] }
  assert.deepEqual(siblingWords(atlases, atlases.color[1], [2]), [siblingWord(2, -2)])
})
