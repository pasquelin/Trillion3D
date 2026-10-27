// The feedback of the rays that read the cards: the compaction's three kernels (`feedbackWgsl.ts`, the shipped WGSL run as
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
  const placed = Array.from({ length: Math.min(count, room - 1) }, (_, at) => [
    listed[2 * (at + 1)],
    listed[2 * (at + 1) + 1],
  ])
  // The table's order is its places': the list is read by element, the page's column and row first.
  return {
    count,
    out: [...placed].sort((a, b) => a[0] - b[0] || (a[1] & 0xffff) - (b[1] & 0xffff)),
    placed,
  }
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

/** The reference's key of a pair, as its hash writes it: the first word mixed, the second folded into it. */
function referenceKey(first: number, second: number) {
  const mul = (a: number, b: number) => Math.imul(a, b) >>> 0
  const left = (word: number, bits: number) => ((word << bits) | (word >>> (32 - bits))) >>> 0
  let hash = first
  hash = (hash ^ (hash >>> 16)) >>> 0
  hash = mul(hash, 0x85ebca6b)
  hash = (hash ^ (hash >>> 13)) >>> 0
  hash = mul(hash, 0xc2b2ae35)
  hash = (hash ^ (hash >>> 16)) >>> 0
  const element = mul(left(mul(second, 0xcc9e2d51), 15), 0x1b873593)
  return (mul(left((hash ^ element) >>> 0, 13), 5) + 0xe6546b64) >>> 0
}

/** A pair whose key the reference's hash makes zero, the empty place's own: a card and level, the page at column 2, row 1. */
const ZERO_KEY: [number, number] = [0xfed9bf52, 0x0102]

const feedbackKeyOf = (first: number, second: number) =>
  shaderRun<{ feedbackKey: (a: number, b: number) => number }>(
    FEEDBACK_COMPACTION_SHADER,
    ['feedbackKey'],
    {},
  ).feedbackKey(first, second)

test('the key of an element is the first word mixed with the second added, as the reference hashes it', () => {
  assert.equal(referenceKey(5, 7), 4183854518)
  for (const [first, second] of [
    [5, 7],
    [0x00ffffff, 0x0f0f00ff],
    [0x12345678, 0],
    [0xffffffff, 0xffff00ff],
  ]) {
    assert.equal(feedbackKeyOf(first, second), referenceKey(first, second))
  }
})

test('a key the hash makes zero is one, so the element is told from the empty place and listed', () => {
  assert.equal(referenceKey(...ZERO_KEY), 0)
  assert.equal(feedbackKeyOf(...ZERO_KEY), 1)
  const made = compacted({
    elements: [[7, 7], ZERO_KEY, ZERO_KEY],
    places: 16,
  })
  assert.deepEqual(made.out, [
    [7, 7 | (1 << 16)],
    [ZERO_KEY[0], ZERO_KEY[1] | (2 << 16)],
  ])
})

test('a table too full to list every element keeps those of its first places, in the order of the places, as the reference’s', () => {
  const elements = Array.from({ length: 40 }, (_, at): [number, number] => [1000 + at * 7, at])
  const places = 64
  const room = 17
  // The reference's table: each distinct key takes the first free place from its own, elements in turn; the list is
  // read place after place, the header taking the first element of the room.
  const taken = new Array<[number, number] | undefined>(places).fill(undefined)
  const keys = new Array<number>(places).fill(0)
  for (const element of elements) {
    const key = referenceKey(...element)
    for (let step = 0; step < 32; step++) {
      const at = (key + step) & (places - 1)
      if (keys[at] === 0) {
        keys[at] = key
        taken[at] = element
        break
      }
    }
  }
  const expected = taken
    .filter((element) => element)
    .slice(0, room - 1)
    .map(([first, second]) => [first, second | (1 << 16)])
  const made = compacted({ elements, places, room })
  assert.equal(made.count, 40)
  assert.deepEqual(made.placed, expected)
})

test('an element the table gives no place is not counted, and adds nothing to the count of another', () => {
  const elements = Array.from({ length: 40 }, (_, at): [number, number] => [at + 1, 0])
  // Keys that all start at one place: the first thirty-two take the places its probes reach, the others find none.
  const made = compacted({ elements, places: 64, room: 64, key: (first) => 5 + 64 * first })
  assert.equal(made.count, 32)
  assert.deepEqual(
    made.out.map(([, second]) => second >>> 16),
    new Array(32).fill(1),
  )
})

/** The workgroups the table's building is asked for, given the counter and the size the feedback buffer holds. */
function buildArgs(counter: number, size: number) {
  const feedback = new Array<number>(FEEDBACK_HEADER_WORDS).fill(0)
  feedback[FEEDBACK_AT.counter] = counter
  feedback[FEEDBACK_AT.size] = size
  const args = [9, 9, 9]
  shaderRun<{ buildFeedbackTableArgs: () => void }>(
    FEEDBACK_COMPACTION_SHADER,
    ['buildFeedbackTableArgs'],
    { feedback, args },
  ).buildFeedbackTableArgs()
  return args
}

test('the table’s building is dispatched over the elements written, the counter held to the buffer’s size, in rows', () => {
  assert.deepEqual(buildArgs(130, 200), [3, 1, 1])
  assert.deepEqual(buildArgs(500, 200), [4, 1, 1], 'a counter past the size')
  assert.deepEqual(buildArgs(0, 200), [0, 1, 1], 'none written')
  assert.deepEqual(buildArgs(64 * 70000, 64 * 70000), [65535, 2, 1], 'past one row of workgroups')
})
