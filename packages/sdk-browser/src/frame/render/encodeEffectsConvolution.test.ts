// The convolution bloom's plan and the transform's passes, against a direct sum and the reference's numbers.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  convolvedBySum,
  testKernel,
  texelGrid,
  transformed,
} from '../../post/effects/bloom/bloom.fixture.ts'
import { analyseKernel, applyConstants } from '../../post/effects/bloom/convolution/kernelStats.ts'
import { planConvolution } from '../../post/effects/bloom/convolution/plan.ts'
import { transformLineOf } from '../../post/effects/bloom/convolution/convolutionPrograms.ts'

test('the convolution plan and the kernel’s reading follow the reference’s numbers', () => {
  const at = (percent: number) =>
    planConvolution({ view: [1920, 1080], percent, size: 1, bufferScale: 0.133 }, LIMITS)
  assert.deepEqual(
    [at(100).image, at(100).frequency],
    [
      [1920, 1080],
      [2048, 2048],
    ],
  )
  assert.deepEqual(
    [at(100).level, at(35.355).level, at(35.355).image, at(25).level],
    [-1, 0, [679, 382], 1],
  )
  // The transform is made for the plan's line: 1024 values at the default half, 2048 at the full.
  assert.deepEqual([at(50), at(100)].map(transformLineOf), [1024, 2048])
  // 4K at 50 %, the default: a line of 2048, which a device of 16 KiB of workgroup memory holds.
  const half = planConvolution(
    { view: [3840, 2160], percent: 50, size: 1, bufferScale: 0.133 },
    { ...LIMITS, maxLine: 2048 },
  )
  assert.deepEqual([half.fraction, Math.max(...half.frequency)], [0.5, 2048])
  const stats = analyseKernel(testKernel(64), 1920, 1)
  const { sceneTint, multiply } = applyConstants(stats, 0.675)
  assert.deepEqual(stats.centre, [32, 32], 'the brightest texel is the centre')
  // The image keeps what the glow leaves, each channel by its own share of the kernel's light: the
  // green and the blue of this kernel carry 0.7 and 0.4 of the red's.
  const kept = [0, 1, 2].map((c) => +(sceneTint[c] + multiply[c]).toFixed(3))
  assert.deepEqual(kept, [1, 0.7, 0.4])
})

const LIMITS = { side: 16384, maxLine: 4096, bytes: 2 ** 31 }

test('the transform’s passes convolve as a direct sum does, each channel by its own kernel sum and scale', () => {
  for (const [w, h] of [
    [6, 5],
    [5, 6],
  ]) {
    // The transform goes along the longer padded side first: both directions are run.
    const plan = planConvolution({ view: [w, h], percent: 100, size: 1, bufferScale: 0 }, LIMITS)
    const [across, down] = plan.frequency
    const image = texelGrid(w, h, (x, y, c) => 1 + ((x * 7 + y * 3 + c * 5) % 11) / 4)
    // A kernel whose channels differ in strength, so a channel divided by another's sum, or scaled
    // by another's multiplier, comes out wrong.
    const kernel = texelGrid(
      across,
      down,
      (x, y, c) => ((x + y) % 5 ? 0.05 : 0.2 + ((x * y) % 3)) * (c + 1),
    )
    const spectrum: number[][] = []
    transformed(kernel, [], spectrum, plan.shapes.kernel)
    const scale = [0.5, 1.5, 2.5, 3.5]
    const glow = transformed(image, spectrum, [], plan.shapes.image, scale)
    convolvedBySum(image, kernel).forEach((row, y) =>
      row.forEach((texel, x) =>
        texel.forEach((value, c) => {
          const expected = value * scale[c]
          assert.ok(
            Math.abs(glow.get(`${x},${y}`)![c] - expected) < 1e-5 * (1 + expected),
            `${plan.horizontalFirst} ${x},${y},${c}`,
          )
        }),
      ),
    )
  }
})
