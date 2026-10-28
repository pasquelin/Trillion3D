// A texture that joins an atlas after open or leaves it moves the stacks its table lists: a stack joined by new
// words keeps what it listed, and no list names a slot a later texture takes (`growth.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileGrowth } from './growth.ts'
import {
  createWebgpuTilePageTable,
  siblingList,
  siblingRef,
  siblingWord,
} from './page/pageTable.ts'
import { tileLayout } from '../texture/tiles.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

function growth() {
  const { device } = fakeDevice()
  const layouts = Array.from({ length: 4 }, () => tileLayout(1024, 1024))
  const atlas = (kind: 'color' | 'data') => ({
    kind,
    pages: createWebgpuTilePageTable(device, layouts, { kind, feedbackOffset: 0 }),
    release() {},
  })
  const color = atlas('color'),
    data = atlas('data')
  const flushes: number[] = []
  const g = createTileGrowth({ device, onColorChanged() {} }, {
    color,
    data,
    feedback: {},
    sources: { release() {} },
    flushAll: () => flushes.push(1),
    followHeaders: () => 0,
    resetRequests() {},
  } as never)
  return { g, color, data, flushes }
}

test('a stack joined by words keeps the siblings a texture listed and replaces one it lists again', () => {
  const { g, color, flushes } = growth()
  const first = siblingWord(siblingRef('color', 2), 0)
  g.stack([{ kind: 'color', slot: 1, words: [first] }])
  g.stack([
    {
      kind: 'color',
      slot: 1,
      words: [siblingWord(siblingRef('data', 3), 1), siblingWord(siblingRef('color', 2), -1)],
    },
  ])
  assert.deepEqual(siblingList(color.pages.words, 1), [
    siblingWord(siblingRef('data', 3), 1),
    siblingWord(siblingRef('color', 2), -1),
  ])
  assert.equal(flushes.length, 2, 'the tables sent once a call')
})

test('a released slot is listed by no texture of either atlas', () => {
  const { g, color, data } = growth()
  const two = siblingWord(siblingRef('color', 2), 0)
  g.stack([
    { kind: 'color', slot: 1, words: [two, siblingWord(siblingRef('data', 3), 0)] },
    { kind: 'color', slot: 2, words: [siblingWord(siblingRef('color', 1), 0)] },
    { kind: 'data', slot: 1, words: [two] },
  ])
  g.release('color', 2)
  assert.deepEqual(siblingList(color.pages.words, 1), [siblingWord(siblingRef('data', 3), 0)])
  assert.deepEqual(siblingList(data.pages.words, 1), [], 'the data atlas’s list too')
  assert.deepEqual(siblingList(color.pages.words, 2), [], 'and the slot lists none itself')
})
