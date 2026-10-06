// The Hi-Z test does not clear the verdicts before it runs: the partition's `classifyRows`
// already wrote every drawable row's this frame. The shipped row routines run over a frame whose
// verdict buffer still holds a previous frame's words (and stale words past the drawable rows):
// with a clear between the partition and the test, and without it, every word is the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { builtins } from '../../texture/shaderRunBuiltins.fixture.ts'
import { structZero } from '../../texture/shaderRunStructs.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { PARTITION_SHADER } from '../partition/shader.ts'
import { HIZ_SHADER } from './shader.ts'
import * as C from '../partition/contract.ts'

type Fn = (...args: unknown[]) => unknown
type Ref = { get: () => number; set: (value: number) => void }
const BOUNDS = Object.keys(structZero(HIZ_SHADER)('Bounds') as object)
const bitsOf = (x: number) => (Number.isInteger(x) ? x >>> 0 : builtins.bitcast_u32(x))

/** One frame of `rows` drawable rows over a verdict buffer of `cap` words left by earlier frames. */
function frame(seed: number, rows: number, cap: number, hasRest: number) {
  const r = random(seed),
    int = (n: number) => Math.floor(r() * n)
  return {
    rows,
    hasRest,
    rowData: Array.from({ length: rows * C.ROW_DATA_U32 }, (_, k) =>
      k % C.ROW_DATA_U32 === C.ROW_FLAGS ? int(32) : int(48) - 8,
    ),
    // A previous frame's verdicts, and words no verdict ever takes: a clear would hide neither.
    flags: Array.from({ length: cap }, () => (int(4) === 0 ? 0xdeadbeef : int(3))),
    items: Array.from({ length: rows }, () => ({ bin: int(3), layer: int(3), triangles: int(99) })),
    boxes: Array.from({ length: rows }, () => ({
      rect: [int(40) - 8, int(40) - 8, int(90), int(90)],
      nearest: r() + 1e-3,
      clips: int(4) === 0 ? 1 : 0,
    })),
    pages: Array.from({ length: rows }, () => ({ hizSlot: r() < 0.1 ? 0xffffffff : 0 })),
  }
}

/** Partition then test, as one frame encodes them; `clear` puts back the clear between the two. */
function verdicts(f: ReturnType<typeof frame>, clear: boolean) {
  const m = {
    rowData: [...f.rowData],
    flags: [...f.flags],
    restBits: new Array<number>(Math.ceil(f.rows / 32)).fill(0),
    slotUsed: new Array<number>(16).fill(0),
    state: new Array<number>(C.STATE_WORDS).fill(0),
    tested: [] as number[],
  }
  const levels = [0, 1, 2, 3].map((k) => [4 * k, 4 * k + 1, 4 * k + 2, 4 * k + 3])
  const scope = {
    ...m,
    items: f.items,
    pages: f.pages,
    atomicAdd: (p: Ref, n: number) => [p.get(), p.set((p.get() + n) >>> 0)][0],
    bitcast_u32: bitsOf,
    bitcast_i32: (x: number) => x | 0,
    projectBox: (i: number) => ({ ...f.boxes[i], rect: [...f.boxes[i].rect] }),
    hiddenByPyramid: (rect: number[]) => (rect[0] & 1) === 0,
    hizLevelFor: (rect: number[]) => [rect[0] & 3, (rect[1] & 3) !== 0 ? 1 : 0, 3],
    pyramidHides: (minX: number, minY: number) => ((minX + minY) & 1) === 0,
    tallyAdd: () => {},
  }
  const uni = { rows: f.rows, width: 64, height: 48, levels: 4, layerTop: 1, hasRest: f.hasRest }
  const partition = shaderRun<Record<string, Fn>>(PARTITION_SHADER, ['projectRow', 'classifyRow'], {
    ...scope,
    uni: { ...uni, viewMoved: 0, levelOffset: levels, levelWidth: levels },
  })
  const bounds: Record<string, number>[] = []
  const hiz = shaderRun<Record<string, Fn>>(HIZ_SHADER, ['testBox'], { ...scope, bounds, uni: {} })
  for (let i = 0; i < f.rows; i++) partition.projectRow(i)
  for (let i = 0; i < f.rows; i++) partition.classifyRow(i)
  // What a clear between the partition and the test wipes: `min(cap, tableRows)` words, `tableRows`
  // being the drawable count (`row/commit.ts`, `row/slots.ts` set both together).
  if (clear) m.flags.fill(0, 0, Math.min(f.flags.length, f.rows))
  for (let k = 0; k < m.state[C.ST_TESTED]; k++) {
    const box = Object.fromEntries(
      BOUNDS.map((name, w) => [name, m.tested[k * C.TESTED_U32 + w] ?? 0]),
    )
    for (const side of ['minX', 'minY', 'maxX', 'maxY']) box[side] |= 0
    box.nearest = builtins.bitcast_f32(box.nearest) as number
    bounds.push(box)
  }
  for (let k = 0; k < m.state[C.ST_TESTED]; k++) hiz.testBox(k)
  return m.flags
}

test('without the clear, every verdict word the test leaves is the one it left with it', () => {
  let tested = 0
  for (const [seed, rows] of [1, 2, 63, 64, 65, 200, 517].entries())
    for (const hasRest of [0, 1]) {
      const f = frame(seed + 1, rows, rows + 9, hasRest)
      const before = verdicts(f, true)
      assert.deepEqual(verdicts(f, false), before, `${rows} rows, rest ${hasRest}`)
      tested += before.slice(0, rows).filter((v) => v !== C.VERDICT_OCCLUDER).length
      // Each drawable row holds one of the three verdicts, none a previous frame's stray word.
      assert.ok(
        before.slice(0, rows).every((v) => v <= C.VERDICT_KEPT),
        `${rows} rows`,
      )
    }
  assert.ok(tested > 0, 'some rows were tested')
})

test("the partition's classification writes each drawable row's verdict, the occluder's as zero", () => {
  assert.equal(C.VERDICT_OCCLUDER, 0)
  assert.match(
    PARTITION_SHADER,
    /if\(id\.x<uni\.rows\)\{classifyRow\(id\.x\);\}/,
    'every row below the count is classified',
  )
  const write = `flags[i]=select(${C.VERDICT_OCCLUDER}u,${C.VERDICT_KEPT}u,rest!=0u);`
  assert.ok(PARTITION_SHADER.includes(write), write)
})
