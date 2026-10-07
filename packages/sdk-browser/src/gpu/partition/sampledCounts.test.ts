// S19.6: the partition's and the occlusion test's counters are kept only on the frame whose copy is
// sampled, one atomic per workgroup and counter. The shipped row routines run lane by lane, each
// workgroup's flush after all its lanes, as its barrier orders them, beside the same routines
// counting by one `state` atomic per row: on a sampled frame `state` holds the same
// words; on every frame the verdicts, rows, rest bits, slot counts and tested boxes are the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { builtins } from '../../texture/shaderRunBuiltins.fixture.ts'
import { structZero } from '../../texture/shaderRunStructs.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { PARTITION_SHADER } from './shader.ts'
import { HIZ_SHADER } from '../hiz/shader.ts'
import { createGpuPartition } from './factory.ts'
import * as C from './contract.ts'
import { HALF_SLOTS, slotCount } from '../draw/contract.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'

type Fn = (...args: unknown[]) => unknown
type Ref = { get: () => number; set: (value: number) => void }
const LANES = C.PARTITION_WORKGROUP
/** The members of a tested box, in the order the test reads its words (`struct Bounds`). */
const BOUNDS = Object.keys(structZero(HIZ_SHADER)('Bounds') as object)
/** `bitcast<u32>` of the kernels' `i32` rectangle words, or of a depth's `f32`. */
const bitsOf = (x: number) => (Number.isInteger(x) ? x >>> 0 : builtins.bitcast_u32(x))

/** `rows` random rows: what each held from the previous image, its item, its projected box. */
function frameOf(seed: number, rows: number) {
  const r = random(seed),
    int = (n: number) => Math.floor(r() * n)
  return {
    rowData: Array.from({ length: rows * C.ROW_DATA_U32 }, (_, k) =>
      k % C.ROW_DATA_U32 === C.ROW_FLAGS ? int(32) : int(48) - 8,
    ),
    flags: Array.from({ length: rows }, () => int(3)),
    items: Array.from({ length: rows }, () => ({
      // A face mode, or its cutout bin.
      bin: int(HALF_SLOTS),
      layer: int(3),
      triangles: int(1 << 24),
    })),
    boxes: Array.from({ length: rows }, () => ({
      rect: [int(40) - 8, int(40) - 8, int(90), int(90)],
      nearest: r() + 1e-3,
      clips: int(4) === 0 ? 1 : 0,
    })),
    pages: Array.from({ length: rows }, () => ({ hizSlot: r() < 0.1 ? 0xffffffff : 0 })),
    viewMoved: int(2),
  }
}

/** The frame through both kernels and the test; `perRow`, each count one atomic on `state`. */
function run(frame: ReturnType<typeof frameOf>, counting: boolean, perRow: boolean) {
  const rows = frame.flags.length
  const m = {
    rowData: [...frame.rowData],
    flags: [...frame.flags],
    restBits: new Array<number>(bitWords(rows)).fill(0),
    // `uni.layerTop` 1: two layers' slots.
    slotUsed: new Array<number>(slotCount(2)).fill(0),
    state: new Array<number>(C.STATE_WORDS).fill(0),
    tested: [] as number[],
    tally: new Array<number>(C.ST_REJECTED_TRIANGLES + 1).fill(0),
  }
  const levels = [0, 1, 2, 3].map((k) => [4 * k, 4 * k + 1, 4 * k + 2, 4 * k + 3])
  const scope = {
    ...m,
    items: frame.items,
    pages: frame.pages,
    // A `u32` atomic wraps: the triangle counts pass 2^32.
    atomicAdd: (p: Ref, n: number) => [p.get(), p.set((p.get() + n) >>> 0)][0],
    bitcast_u32: bitsOf,
    bitcast_i32: (x: number) => x | 0,
    workgroupBarrier: () => {},
    // What the pyramids answer: a function of what is asked, the same in both runs.
    projectBox: (i: number) => ({ ...frame.boxes[i], rect: [...frame.boxes[i].rect] }),
    hiddenByPyramid: (rect: number[]) => (rect[0] & 1) === 0,
    hizLevelFor: (rect: number[]) => [rect[0] & 3, (rect[1] & 3) !== 0 ? 1 : 0, 3],
    pyramidHides: (minX: number, minY: number) => ((minX + minY) & 1) === 0,
    ...(perRow && {
      tallyAdd: (word: number, n: number) => (m.state[word] = (m.state[word] + n) >>> 0),
    }),
  }
  const counted = counting ? 1 : 0,
    own = perRow ? [] : ['tallyAdd', 'flushTally']
  const uni = {
    rows,
    width: 64,
    height: 48,
    levels: 4,
    layerTop: 1,
    hasRest: 1,
    counting: counted,
  }
  const partition = shaderRun<Record<string, Fn>>(
    PARTITION_SHADER,
    ['projectRow', 'classifyRow', ...own],
    {
      ...scope,
      uni: { ...uni, viewMoved: frame.viewMoved, levelOffset: levels, levelWidth: levels },
    },
  )
  const bounds: Record<string, number>[] = []
  const hiz = shaderRun<Record<string, Fn>>(HIZ_SHADER, ['testBox', ...own], {
    ...scope,
    bounds,
    uni: { counting: counted },
  })
  /** `routine` over `count` threads, a workgroup at a time, its flush after all its lanes. */
  const each = (routine: Fn, count: number, flushTally: Fn | undefined) => {
    for (let base = 0; base < count; base += LANES) {
      m.tally.fill(0)
      for (let lane = 0; lane < LANES && base + lane < count; lane++) routine(base + lane)
      for (let lane = 0; lane < LANES && flushTally; lane++) flushTally(lane)
    }
  }
  each(partition.projectRow, rows, partition.flushTally)
  each(partition.classifyRow, rows, partition.flushTally)
  for (let k = 0; k < m.state[C.ST_TESTED]; k++) {
    const words = BOUNDS.map((name, w) => [name, m.tested[k * C.TESTED_U32 + w] ?? 0])
    const box = Object.fromEntries(words)
    for (const side of ['minX', 'minY', 'maxX', 'maxY']) box[side] |= 0
    box.nearest = builtins.bitcast_f32(box.nearest) as number
    bounds.push(box)
  }
  each(hiz.testBox, m.state[C.ST_TESTED], hiz.flushTally)
  return { ...m, tally: undefined }
}

test('a sampled frame counts what one atomic per row counted; the image reads the same words', () => {
  const seen = new Array<number>(C.STATE_WORDS).fill(0)
  for (const [seed, rows] of [1, 63, 64, 65, 200, 517].entries()) {
    const frame = frameOf(seed + 1, rows)
    const before = run(frame, true, true)
    before.state.forEach((word, at) => (seen[at] += word))
    assert.deepEqual(run(frame, true, false), before, `${rows} rows`)
    // Another frame: no counter but the tested boxes' allocator, the rest unchanged.
    const quiet = run(frame, false, false)
    const counters = before.state.map((word, at) => (at === C.ST_TESTED ? word : 0))
    assert.deepEqual(quiet, { ...before, state: counters }, `${rows} rows, not sampled`)
  }
  // Every counter the kernels keep was reached.
  assert.ok(
    seen.slice(0, C.ST_REJECTED_TRIANGLES + 1).every((total) => total > 0),
    `${seen}`,
  )
})

test('every counter but the allocator goes through the tally; the kernels flush it once', () => {
  for (const text of [PARTITION_SHADER, HIZ_SHADER]) {
    const atomics = [...text.matchAll(/atomicAdd\(&state\[(\d+)u\]/g)].map((match) =>
      Number(match[1]),
    )
    assert.deepEqual(atomics, text === HIZ_SHADER ? [] : [C.ST_TESTED])
  }
  assert.match(
    PARTITION_SHADER,
    /if\(id\.x<uni\.rows\)\{projectRow\(id\.x\);\}\n flushTally\(lane\);/,
  )
  assert.match(
    PARTITION_SHADER,
    /if\(id\.x<uni\.rows\)\{classifyRow\(id\.x\);\}\n flushTally\(lane\);/,
  )
  assert.match(HIZ_SHADER, /\{testBox\(id\.x\);\}\n flushTally\(lane\);/)
})

test('the partition copies its counters on the frame that counted, and only then', async () => {
  const { device } = fakeDevice()
  const buffer = (label: string) => ({ label, size: 4, destroy() {} }) as unknown as GPUBuffer
  let at = 0
  // A frame from 40 to 44 has no pyramid: it runs no kernel, counts nothing, and its sample waits.
  const partition = (await createGpuPartition(device, 4, {
    ...{ items: buffer('i'), flags: buffer('f'), restBits: buffer('r'), slotUsed: buffer('s') },
    pyramid: () => (at < 40 || at > 44 ? buffer('pyramid') : undefined),
  }))!
  const copies: number[] = []
  const pass = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }
  const encoder = {
    clearBuffer() {},
    beginComputePass: () => pass,
    copyBufferToBuffer: () => void copies.push(at),
  } as unknown as GPUCommandEncoder
  const matrix = new Float64Array(16),
    sizes = { width: 8, height: 8, levels: [], layerTop: 0, hasRest: true, viewMoved: false }
  const frame = { view: matrix, viewProj: matrix, anchor: [0, 0, 0] as const, near: 1, rows: 4 }
  for (; at < 60; at++) {
    // The caller's one `countsDue` answer: the frame's `counting`.
    const counting = partition.countsDue(at)
    partition.beginFrame(encoder, { ...frame, ...sizes, counting })
    assert.equal(partition.counting, counting && (at < 40 || at > 44), `frame ${at}`)
    partition.encodeCounts(encoder, at)
    partition.countsSubmitted()
    // The sample maps once the frame is submitted: the next is due fifteen frames on.
    await new Promise((settled) => setTimeout(settled))
  }
  assert.deepEqual(copies, [0, 15, 30, 45])
  partition.dispose()
})
