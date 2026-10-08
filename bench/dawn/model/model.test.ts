import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BenchReport } from '../merge.ts'
import { floorOf } from './floor.ts'
import { frameOf, modelRows, modelText } from './modelTable.ts'
import { PASSES, type Frame } from './passes.ts'

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
  rough: 0,
}
const pass = (label: string) => PASSES.find((p) => p.label === label)!

test('a floor is its slowest resource at its peak, plus a fixed cost a pass', () => {
  // 400 MB at 400 GB/s: 1 ms; 100 M texels at 500 Gtexel/s: 0.2 ms.
  assert.deepEqual(floorOf({ bytes: 400e6, texels: 100e6 }, MACHINE), { ms: 1, bound: 'bytes' })
  const f = floorOf({ texels: 1e9, bytes: 4e6, passes: 2 }, MACHINE)
  assert.equal(f.bound, 'texels')
  assert.ok(Math.abs(f.ms - (2 + 0.02)) < 1e-12)
  assert.deepEqual(floorOf({ flops: 1e9 }, MACHINE), { ms: 0, bound: 'pass' }, 'an unmeasured peak')
})

test('the passes count their shipped constants', () => {
  // TAA at half the display per axis: 30 fetches a display pixel, 48 B of targets a pixel.
  const taa = pass('temporal antialiasing').work(frame)
  assert.equal(taa.texels! / frame.D, 30)
  assert.equal(taa.bytes, 48 * frame.D + 17 * frame.P)
  // One sun: one ray of nine samples, two fetches each, plus the screen ray's five.
  const vsm = pass('vsm.projection').work(frame)
  assert.equal(vsm.texels, frame.P * (5 + 9 * 2))
  // Four lights fill one mask layer, five two.
  assert.equal(pass('vsm.projection').work({ ...frame, L: 5 }).bytes, 21 * frame.P + 8 * frame.P)
  assert.equal(pass('visibility primary').work(frame).triangles, frame.T)
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
        { name: 'temporal antialiasing', median: 3 },
        { name: 'HDR composition + present', median: 0.2 },
        { name: 'mystery', median: 0.5 },
      ],
    },
  ],
} as unknown as BenchReport

test('a measured frame ranks its passes by the milliseconds above their floor', () => {
  const f = frameOf(report, { cover: 1, reach: 1, rough: 0, placements: 1e3 })
  assert.deepEqual(f, frame)
  const model = modelRows(report, f, MACHINE)
  assert.deepEqual(
    model.rows.map((r) => r.label),
    ['temporal antialiasing', 'HDR composition + present'],
  )
  assert.ok(model.rows[0].aboveMs > model.rows[1].aboveMs)
  assert.deepEqual(model.unmodelled, [{ label: 'mystery', ms: 0.5 }])
  assert.match(modelText(model, f), /Not modelled: mystery 0\.500/)
})
