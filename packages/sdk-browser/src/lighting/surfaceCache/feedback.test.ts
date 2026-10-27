// The feedback of the rays that read the cards: the compaction's two kernels (`feedbackWgsl.ts`, the shipped WGSL run as
// JavaScript by `shaderRun`) and the header the read library indexes the buffer by (`feedbackLayout.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { FEEDBACK_AT, FEEDBACK_HEADER_WORDS, feedbackWords } from './feedbackLayout.ts'
import { FEEDBACK_COMPACTION_SHADER } from './feedbackWgsl.ts'
import { surfaceCacheSampleWgsl } from './sampleWgsl.ts'

type Kernels = {
  buildFeedbackTable: (id: number[], groups: number[]) => void
  compactFeedbackTable: (id: number[], groups: number[]) => void
}

/** What the compaction is given: the elements written (each its two words), how many the counter says and the buffer's
 *  size, the places of the table of keys and the elements the list holds, header included; the key of an element. */
interface Image {
  elements: [number, number][]
  counter?: number
  size?: number
  places?: number
  room?: number
  key?: (first: number, second: number) => number
}

/** The compaction run over `image`: the list it makes, its first word the elements it counted. */
function compacted({ elements, counter, size, places = 16, room = 8, key }: Image) {
  const feedback = new Array<number>(FEEDBACK_HEADER_WORDS + 2 * elements.length).fill(0)
  feedback[FEEDBACK_AT.counter] = counter ?? elements.length
  feedback[FEEDBACK_AT.elements] = FEEDBACK_HEADER_WORDS
  feedback[FEEDBACK_AT.size] = size ?? elements.length
  elements.forEach(([first, second], at) => {
    feedback[FEEDBACK_HEADER_WORDS + 2 * at] = first
    feedback[FEEDBACK_HEADER_WORDS + 2 * at + 1] = second
  })
  const [keys, firsts, counts] = [0, 1, 2].map(() => new Array<number>(places).fill(0))
  const listed = new Array<number>(2 * room).fill(0)
  const run = shaderRun<Kernels>(
    FEEDBACK_COMPACTION_SHADER,
    ['buildFeedbackTable', 'compactFeedbackTable'],
    { feedback, keys, firsts, counts, listed, ...(key && { feedbackKey: key }) },
  )
  const dispatch = (kernel: (id: number[], groups: number[]) => void, threads: number) => {
    const groups = Math.ceil(threads / 64)
    for (let thread = 0; thread < groups * 64; thread++) kernel([thread, 0, 0], [groups, 1, 1])
  }
  dispatch(run.buildFeedbackTable, elements.length)
  dispatch(run.compactFeedbackTable, places)
  const count = listed[0]
  const out = Array.from({ length: Math.min(count, room - 1) }, (_, at) => [
    listed[2 * (at + 1)],
    listed[2 * (at + 1) + 1],
  ])
  // The table's order is its places': the list is read by element, the page's column and row first.
  return { count, out: out.sort((a, b) => a[0] - b[0] || (a[1] & 0xffff) - (b[1] & 0xffff)) }
}

/** The key of the pair that makes each distinct pair its own, so that the table's places are the test's to place. */
const own = (first: number, second: number) => 1 + first * 8 + second

test('the compaction lists each distinct element once, the number of times it was written in the high half of its second word', () => {
  const [a, b, c]: [number, number][] = [
    [1, 0],
    [1, 1],
    [2, 0],
  ]
  const made = compacted({ elements: [a, b, a, c, a, b, a, a], key: own })
  assert.equal(made.count, 3)
  assert.deepEqual(made.out, [
    [1, 0 | (5 << 16)],
    [1, 1 | (2 << 16)],
    [2, 0 | (1 << 16)],
  ])
})

test('two elements whose keys fall on one place of the table take the next free one, each counted apart', () => {
  // Keys 3 and 19 are one place of a table of sixteen.
  const made = compacted({
    elements: [
      [2, 0],
      [18, 0],
      [2, 0],
    ],
    key: (first) => 1 + first,
  })
  assert.deepEqual(made.out, [
    [2, 0 | (2 << 16)],
    [18, 0 | (1 << 16)],
  ])
})

test('past the list’s room the count says how many there were, and the list holds those it had room for', () => {
  const elements = [1, 2, 3, 4, 5].map((first): [number, number] => [first, 0])
  const made = compacted({ elements, places: 16, room: 4, key: own })
  assert.equal(made.count, 5)
  assert.equal(made.out.length, 3, 'the header takes the first of four')
})

test('only the elements the counter and the buffer’s size both allow are taken', () => {
  const elements: [number, number][] = [1, 2, 3, 4].map((first) => [first, 0])
  assert.equal(compacted({ elements, counter: 3, key: own }).count, 3, 'the counter’s three')
  assert.equal(
    compacted({ elements, counter: 9, size: 2, key: own }).count,
    2,
    'a counter past the size',
  )
})

test('the buffer’s parts follow the header, the last-read part a power of two of pages, 256 at least', () => {
  const words = feedbackWords(100, 1000)
  assert.deepEqual(
    [words.elements, words.lastUsedHiRes, words.pages, words.words],
    [FEEDBACK_HEADER_WORDS, FEEDBACK_HEADER_WORDS + 200, 1024, FEEDBACK_HEADER_WORDS + 200 + 1024],
  )
  assert.equal(feedbackWords(1, 3).pages, 256)
})

test('the header’s words are the ones the read library indexes the feedback buffer by', () => {
  const text = wgslModule(surfaceCacheSampleWgsl(0, 0, { feedback: true, compressed: false }))
  const indexed = new Set(
    [...text.matchAll(/scFeedback\[(\d+)\]/g)].map((match) => Number(match[1])),
  )
  assert.deepEqual(
    [...indexed].sort((a, b) => a - b),
    Object.values(FEEDBACK_AT).sort((a, b) => a - b),
  )
})
