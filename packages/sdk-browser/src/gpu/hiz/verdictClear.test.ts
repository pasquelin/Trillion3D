// The Hi-Z test clears no verdict before it runs: the partition's `classifyRows` already wrote
// every drawable row's this frame, and a row it sends to no test (cut by the near plane, off
// screen, no pick) keeps the kept verdict written there. The shipped row routines run over a frame
// whose verdict buffer still holds a previous frame's words (and stale words past the drawable
// rows): every drawable row holds this frame's verdict, every word past them its old one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { PARTITION_SHADER } from '../partition/shader.ts'
import { HIZ_SHADER } from './shader.ts'
import { rowRoutineScope, testedBounds } from './rowRoutines.fixture.ts'
import * as C from '../partition/contract.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

type Fn = (...args: unknown[]) => unknown

/** One frame of `rows` drawable rows over a verdict buffer of `cap` words left by earlier frames. */
function frame(seed: number, rows: number, cap: number, hasRest: number) {
  const r = lcgRandom(seed),
    int = (n: number) => Math.floor(r() * n)
  return {
    rows,
    hasRest,
    rowData: Array.from({ length: rows * C.ROW_DATA_U32 }, (_, k) =>
      k % C.ROW_DATA_U32 === C.ROW_FLAGS ? int(32) : int(48) - 8,
    ),
    // A previous frame's verdicts, and words no verdict ever takes: a clear would hide neither.
    flags: Array.from({ length: cap }, () => (int(4) === 0 ? 0xdeadbeef : int(3))),
    items: Array.from({ length: rows }, (_, row) => ({
      bin: int(3),
      layer: int(3),
      triangles: int(99),
      selectionIndex: row,
    })),
    // The cut's draw mask: a row it leaves undrawn goes to no test and keeps the kept verdict.
    selectionMask: Array.from({ length: bitWords(rows) }, () => int(2 ** 32)),
    boxes: Array.from({ length: rows }, () => ({
      rect: [int(40) - 8, int(40) - 8, int(90), int(90)],
      nearest: r() + 1e-3,
      clips: int(4) === 0 ? 1 : 0,
    })),
    pages: Array.from({ length: rows }, () => ({ hizSlot: r() < 0.1 ? 0xffffffff : 0 })),
  }
}

/** Partition then test, as one frame encodes them: the verdicts, the rows sent to the test with
 *  their boxes, and the rest's bits. */
function verdicts(f: ReturnType<typeof frame>) {
  const m = {
    rowData: [...f.rowData],
    flags: [...f.flags],
    restBits: new Array<number>(bitWords(f.rows)).fill(0),
    state: new Array<number>(C.STATE_WORDS).fill(0),
    tested: [] as number[],
  }
  const scope = {
    ...m,
    items: f.items,
    pages: f.pages,
    selectionMask: f.selectionMask,
    ...rowRoutineScope,
    projectBox: (i: number) => ({ ...f.boxes[i], rect: [...f.boxes[i].rect] }),
    tallyAdd: () => {},
  }
  const uni = {
    ...{ rows: f.rows, width: 64, height: 48, layerTop: 1, hasRest: f.hasRest },
    ...{ selectionEnabled: 1, selectionOffset: 0 },
  }
  const partition = shaderRun<Record<string, Fn>>(
    PARTITION_SHADER,
    ['projectRow', 'classifyRow', 'bitWord', 'bitMask'],
    {
      ...scope,
      uni,
    },
  )
  const bounds: Record<string, number>[] = []
  const hiz = shaderRun<Record<string, Fn>>(HIZ_SHADER, ['testBox'], { ...scope, bounds, uni: {} })
  for (let i = 0; i < f.rows; i++) partition.projectRow(i)
  for (let i = 0; i < f.rows; i++) partition.classifyRow(i)
  bounds.push(...testedBounds(m.tested, m.state[C.ST_TESTED]))
  for (let k = 0; k < m.state[C.ST_TESTED]; k++) hiz.testBox(k)
  return { flags: m.flags, bounds, restBits: m.restBits }
}

test("without a clear, every drawable row holds this frame's verdict, every word past them its own", () => {
  let tested = 0,
    untested = 0
  for (const [seed, rows] of [1, 2, 63, 64, 65, 200, 517].entries())
    for (const hasRest of [0, 1]) {
      const f = frame(seed + 1, rows, rows + 9, hasRest),
        { flags, bounds, restBits } = verdicts(f)
      // An occluder's zero; a rest row's test verdict where it was sent to the test, with a slot
      // (the fake pyramid hides an even corner), else the kept one.
      const expected = f.flags.map((old, i) => {
        if (i >= rows) return old
        if (!((restBits[i >>> 5] >>> (i & 31)) & 1)) return C.VERDICT_OCCLUDER
        const box = bounds.find((b) => b.row === i)
        // A row the cut leaves undrawn is sent to no test.
        if (!((f.selectionMask[i >>> 5] >>> (i & 31)) & 1)) assert.equal(box, undefined, `row ${i}`)
        if (!box) return (untested++, C.VERDICT_KEPT)
        tested++
        if (f.pages[i].hizSlot === 0xffffffff) return C.VERDICT_KEPT
        return (box.minX + box.minY) & 1 ? C.VERDICT_KEPT : C.VERDICT_REJECTED
      })
      assert.deepEqual(flags, expected, `${rows} rows, rest ${hasRest}`)
    }
  assert.ok(tested > 0 && untested > 0, 'rows tested and rows kept untested')
})

test("the partition's classification writes each drawable row's verdict, the occluder's as zero", () => {
  assert.equal(C.VERDICT_OCCLUDER, 0)
  assert.match(
    PARTITION_SHADER,
    /if\(row<uni\.rows\)\{classifyRow\(row\);\}/,
    'every row below the count is classified',
  )
  const write = `flags[i]=select(${C.VERDICT_OCCLUDER}u,${C.VERDICT_KEPT}u,rest!=0u);`
  assert.ok(PARTITION_SHADER.includes(write), write)
})
