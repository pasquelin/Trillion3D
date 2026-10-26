import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import type { BenchReport } from '../report/merge.ts'
import { floorOf } from './floor.ts'
import { frameOf, modelRows, modelText } from './modelTable.ts'
import { PASSES } from './passes.ts'
import {
  DAG_FIXED_DISPATCHES,
  DAG_LEVEL_DISPATCHES,
  TRACE_SHARE,
  type Frame,
} from './passConstants.ts'
import { encodeDagKernels } from '../../../packages/sdk-browser/src/geometry/dag/encode.ts'
import {
  cutResources,
  witnessEncoder,
} from '../../../packages/sdk-browser/src/geometry/dag/encode.fixture.ts'
import { REPOSITORY_ROOT } from '../../../scripts/git/repository-files.ts'
import { countTaaFetches } from '../../runner/counts/taaFetchCount.ts'
import { TAA_DISPLAY_BYTES, TAA_RENDER_BYTES } from '../../runner/counts/taaPassBytes.ts'

// 400 GB/s of memory, 500 Gtexel/s, 400 GB/s of attachment (50 Gpixel/s), 4 Gtriangle/s, 0.01 ms a pass.
const MACHINE = {
  readGBs: 400,
  writeGBs: 300,
  texelLoadG: 500,
  attachmentGBs: 400,
  trianglesG: 4,
  passMs: 0.01,
}
const frame: Frame = {
  P: 2056 * 1144,
  D: 4112 * 2294,
  cover: 1,
  T: 1e6,
  R: 1e4,
  N: 1e3,
  L: 1,
  reach: 1,
  reflecting: 0,
}
const pass = (label: string) => PASSES.find((p) => p.label === label)!
/** The temporal passes' rows, in their order. */
const TAA_LABELS = [
  'temporal measure flickering luma',
  'temporal measure thin geometry coverage',
  'temporal dilate velocity',
  'temporal decimate history',
  'temporal detect thin geometry',
  'temporal thin geometry weight relaxation',
  'temporal reject shading',
  'temporal spatial anti-aliasing',
  'temporal update history',
  'temporal resolve history',
  'temporal resolve display layers',
]

test('a floor is its slowest resource at its peak, plus a fixed cost a pass', () => {
  // 400 MB at 400 GB/s: 1 ms; 100 M texels at 500 Gtexel/s: 0.2 ms.
  assert.deepEqual(floorOf({ bytes: 400e6, texels: 100e6 }, MACHINE), { ms: 1, bound: 'bytes' })
  const f = floorOf({ texels: 1e9, bytes: 4e6, passes: 2 }, MACHINE)
  assert.equal(f.bound, 'texels')
  assert.ok(Math.abs(f.ms - (2 + 0.02)) < 1e-12)
  assert.deepEqual(floorOf({ flops: 1e9 }, MACHINE), { ms: 0, bound: 'pass' }, 'an unmeasured peak')
})

test('the passes count their shipped constants', () => {
  // TAA at half the display per axis, split into its eight passes as the engine times them
  // (`TAA_*_PASS`), the rows summing to the temporal pass's: its analysis' fetches a render texel
  // over the four a display pixel holds, and its update and resolve's (`taaFetchCount.test.ts`);
  // 61 B a display pixel: the history at twice the display per axis, five bytes a pixel (11-11-10
  // colour, the one-byte validity since the metadata holds it alone and the as-is pixels are
  // composed after the temporal pass), read and written by the update (40) beside the half-size
  // image (1: a quarter texel of the history's colour format, 11-11-10 floats), and the history's resolve (16 read, 4 written: its colour in the history's 11-11-10
  // format, no share);
  // and 157 B a render pixel: the analysis's 68 B of targets (the anti-aliaser's mask among them, one byte, an `r8uint` texture where the device grants the storage textures it takes, as a desktop adapter's eight do — a word on a device at WebGPU's guaranteed four —, written by the rejection and read by the anti-aliaser) written and read back (the scene
  // colour's 4 B and the luma's 1 B buffers among them, the four bytes of the measures taken before
  // the translucency and of the thin geometry's outputs since their passes are their own), 21 B of inputs — colour, depth,
  // identifier, the r32uint flags, the blends' responsiveness.
  const rows = TAA_LABELS.map((label) => pass(label).work(frame))
  const sum = (key: 'bytes' | 'texels') => rows.reduce((total, row) => total + row[key]!, 0)
  const fetches = countTaaFetches(0.5)
  // To the last bits: the shading rejection's fetches a texel are a share of its tile (32² read,
  // 26² written), no longer a sum of powers of two.
  assert.ok(Math.abs(sum('texels') / frame.D - (fetches.analysis / 4 + fetches.resolve)) < 1e-9)
  assert.equal(sum('bytes'), 61 * frame.D + 157 * frame.P)
  assert.equal(sum('bytes'), TAA_DISPLAY_BYTES * frame.D + TAA_RENDER_BYTES * frame.P)
  // Each pass its own: the two measures 1 B a render pixel each, the nearest velocity 33, the
  // reprojection 41, the thin geometry's detection 5 and relaxation 6, the shading rejection 44 (its mask included), the
  // anti-aliaser 4, the update 22 and 41 a display pixel,
  // the resolve 20 a display pixel; the display layers' resolve none in this frame.
  const per = (unit: Pick<Frame, 'P' | 'D'>) =>
    TAA_LABELS.map((label) => pass(label).work({ ...frame, ...unit }).bytes)
  // The measures before the translucency, a byte each; the thin geometry's word between the detection
  // and its weight relaxation, the mask and the coverage history bytes it writes.
  assert.deepEqual(per({ P: 1, D: 0 }), [1, 1, 33, 41, 5, 6, 44, 4, 22, 0, 0])
  assert.deepEqual(per({ P: 0, D: 1 }), [0, 0, 0, 0, 0, 0, 0, 0, 41, 20, 0])
  // One sun: one ray of five samples, two fetches each, plus the screen ray's start and four samples.
  const vsm = pass('vsm.projection').work(frame)
  assert.equal(vsm.texels, frame.P * (5 + 5 * 2))
  // Four lights fill one mask layer, five two.
  assert.equal(pass('vsm.projection').work({ ...frame, L: 5 }).bytes, 21 * frame.P + 8 * frame.P)
  assert.equal(pass('visibility primary').work(frame).triangles, frame.T)
  // A reflecting block of the default level's pixels (`TRACE_SHARE`) marches one ray: 16 iterations
  // of three texels, four loads before and three at its hit.
  const trace = pass('reflection trace')
  const marched = (reflecting: number) => trace.work({ ...frame, reflecting }).texels!
  assert.equal((marched(1) - marched(0)) / frame.P, (4 + 16 * 3 + 3) / TRACE_SHARE)
})

const report = {
  bench: { display: { width: 4112, height: 2294 } },
  engine: {
    renderWidth: 2056,
    renderHeight: 1144,
    drawnTriangles: 1e6,
    clusters: 1e4,
    shadowVsmLights: 1,
  },
  segments: [
    {
      name: 'sway',
      measured: true,
      gpuMs: { median: 9 },
      benchPasses: [
        { name: 'temporal update history', median: 6 },
        { name: 'HDR composition + present', median: 0.2 },
        { name: 'mystery', median: 0.5 },
      ],
    },
  ],
} as unknown as BenchReport

test('a measured frame ranks its passes by the milliseconds above their floor', () => {
  const f = frameOf(report, { cover: 1, reach: 1, reflecting: 0, placements: 1e3 })
  assert.deepEqual(f, frame)
  const model = modelRows(report, f, MACHINE)
  assert.deepEqual(
    model.rows.map((r) => r.label),
    ['temporal update history', 'HDR composition + present'],
  )
  assert.ok(model.rows[0].aboveMs > model.rows[1].aboveMs)
  assert.deepEqual(model.unmodelled, [{ label: 'mystery', ms: 0.5 }])
  assert.match(modelText(model, f), /Not modelled: mystery 0\.500/)
})

test('every source a pass cites holds its symbol, and its formula the bytes its work counts', () => {
  const missing = PASSES.flatMap((p) =>
    p.sources
      .filter(({ path, symbol }) => {
        const file = join(REPOSITORY_ROOT, path)
        if (!existsSync(file)) return true
        const text = readFileSync(file, 'utf8')
        return path.endsWith('.md')
          ? !text.includes(`## ${symbol}`)
          : !new RegExp(`\\b(?:const|function|let) ${symbol}\\b`).test(text)
      })
      .map(({ path, symbol }) => `${p.label}: ${path} ${symbol}`),
  )
  assert.deepEqual(missing, [])
  // The selection's rows: the formula's bytes a row are those its work counts.
  const dag = pass('DAG selection')
  const perRow = dag.work({ ...frame, N: 1, R: 0 }).bytes!
  assert.ok(dag.formula.includes(`${perRow} B`), `${dag.formula} counts ${perRow} B a row`)
})

test('the selection’s dispatches are the encoder’s: five, and two a level', () => {
  for (const levels of [2, 3, 4, 5]) {
    const witness = witnessEncoder()
    encodeDagKernels(witness.encoder as never, cutResources(levels) as never)
    const { dispatches, armements } = witness.read()
    assert.equal(
      dispatches.length + armements.length,
      DAG_FIXED_DISPATCHES + DAG_LEVEL_DISPATCHES * levels,
      `${levels} levels`,
    )
  }
})
