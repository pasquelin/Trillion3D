// S19.6: the partition's and the occlusion test's counters are kept only on the frame whose copy is
// sampled, one atomic per workgroup and counter. The shipped row routines run lane by lane, each
// workgroup's flush after all its lanes, as its barrier orders them, beside the same routines
// counting by one `state` atomic per row: on a sampled frame `state` holds the same
// words; on every frame the verdicts, rows, rest bits, slot counts and tested boxes are the same.
import { WORKGROUP_THREADS } from '../dispatch/grid.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { PARTITION_SHADER } from './shader.ts'
import { HIZ_SHADER } from '../hiz/shader.ts'
import { rowRoutineScope, testedBounds } from '../hiz/rowRoutines.fixture.ts'
import { createGpuPartition } from './factory.ts'
import * as C from './contract.ts'
import { HALF_SLOTS } from '../draw/contract.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

type Fn = (...args: unknown[]) => unknown

/** `rows` random rows: what each held from the previous image, its item, its projected box. */
function frameOf(seed: number, rows: number) {
  const r = lcgRandom(seed),
    int = (n: number) => Math.floor(r() * n)
  return {
    rowData: Array.from({ length: rows * C.ROW_DATA_U32 }, (_, k) =>
      k % C.ROW_DATA_U32 === C.ROW_FLAGS ? int(32) : int(48) - 8,
    ),
    flags: Array.from({ length: rows }, () => int(3)),
    items: Array.from({ length: rows }, (_, row) => ({
      // A face mode, its cutout bin or its voxel bin.
      bin: int(HALF_SLOTS),
      layer: int(3),
      triangles: int(1 << 24),
      selectionIndex: row,
    })),
    // The cut's draw mask: a row it leaves undrawn is neither tested nor counted.
    selectionMask: Array.from({ length: bitWords(rows) }, () => int(2 ** 32)),
    boxes: Array.from({ length: rows }, () => ({
      rect: [int(40) - 8, int(40) - 8, int(90), int(90)],
      nearest: r() + 1e-3,
      clips: int(4) === 0 ? 1 : 0,
    })),
    pages: Array.from({ length: rows }, () => ({ hizSlot: r() < 0.1 ? 0xffffffff : 0 })),
  }
}

/** The frame through both kernels and the test; `perRow`, each count one atomic on `state`. */
function run(frame: ReturnType<typeof frameOf>, counting: boolean, perRow: boolean) {
  const rows = frame.flags.length
  const m = {
    rowData: [...frame.rowData],
    flags: [...frame.flags],
    restBits: new Array<number>(bitWords(rows)).fill(0),
    state: new Array<number>(C.STATE_WORDS).fill(0),
    tested: [] as number[],
    tally: new Array<number>(C.ST_VOXEL_TRIANGLES + 1).fill(0),
  }
  const scope = {
    ...m,
    items: frame.items,
    pages: frame.pages,
    selectionMask: frame.selectionMask,
    ...rowRoutineScope,
    workgroupBarrier: () => {},
    projectBox: (i: number) => ({ ...frame.boxes[i], rect: [...frame.boxes[i].rect] }),
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
    layerTop: 1,
    hasRest: 1,
    counting: counted,
    selectionEnabled: 1,
    selectionOffset: 0,
  }
  const partition = shaderRun<Record<string, Fn>>(
    PARTITION_SHADER,
    ['projectRow', 'classifyRow', 'voxelTally', 'bitWord', 'bitMask', ...own],
    {
      ...scope,
      uni,
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
    for (let base = 0; base < count; base += WORKGROUP_THREADS) {
      m.tally.fill(0)
      for (let lane = 0; lane < WORKGROUP_THREADS && base + lane < count; lane++)
        routine(base + lane)
      for (let lane = 0; lane < WORKGROUP_THREADS && flushTally; lane++) flushTally(lane)
    }
  }
  each(partition.projectRow, rows, partition.flushTally)
  each(partition.classifyRow, rows, partition.flushTally)
  bounds.push(...testedBounds(m.tested, m.state[C.ST_TESTED]))
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
    seen.slice(0, C.ST_VOXEL_TRIANGLES + 1).every((total) => total > 0),
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
  assert.match(PARTITION_SHADER, /if\(row<uni\.rows\)\{projectRow\(row\);\}\n flushTally\(lane\);/)
  assert.match(PARTITION_SHADER, /if\(row<uni\.rows\)\{classifyRow\(row\);\}\n flushTally\(lane\);/)
  assert.match(HIZ_SHADER, /\{testBox\(i\);\}\n flushTally\(lane\);/)
})

test('the partition copies its counters on the frame that counted, and only then', async () => {
  const fake = fakeDevice(),
    { device } = fake
  const buffer = (label: string) => ({ label, size: 4, destroy() {} }) as unknown as GPUBuffer
  let at = 0
  // A frame from 40 to 44 has no pyramid: it runs no kernel, counts nothing, and its sample waits.
  const partition = (await createGpuPartition(device, 4, {
    ...{ items: buffer('i'), flags: buffer('f'), restBits: buffer('r'), hizLevels: buffer('l') },
    pyramid: () => (at < 40 || at > 44 ? ({} as GPUTextureView) : undefined),
  }))!
  /** The frames whose encoding copied. */
  const copies: number[] = []
  const encoder = device.createCommandEncoder()
  const matrix = new Float64Array(16),
    sizes = { width: 8, height: 8, layerTop: 0, hasRest: true, cull: 'follow' as const }
  const frame = { view: matrix, viewProj: matrix, anchor: [0, 0, 0] as const, near: 1, rows: 4 }
  for (; at < 60; at++) {
    // The caller's one `countsDue` answer: the frame's `counting`.
    const counting = partition.countsDue(at)
    const copied = fake.copies.length
    partition.beginFrame(encoder, { ...frame, ...sizes, counting })
    assert.equal(partition.counting, counting && (at < 40 || at > 44), `frame ${at}`)
    partition.encodeCounts(encoder, at)
    if (fake.copies.length > copied) copies.push(at)
    partition.countsSubmitted()
    // The sample maps once the frame is submitted: the next is due fifteen frames on.
    await new Promise((settled) => setTimeout(settled))
  }
  assert.deepEqual(copies, [0, 15, 30, 45])
  partition.dispose()
})
