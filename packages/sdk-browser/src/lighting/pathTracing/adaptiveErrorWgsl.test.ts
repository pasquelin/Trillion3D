// The error chain's level (`ptAdaptiveErrorLevel`), run in JavaScript from the shipped text over a level held as an array.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import {
  PT_ADAPTIVE_ERROR_ENTRY,
  PT_ADAPTIVE_ERROR_KERNEL_WGSL,
  PT_ADAPTIVE_ERROR_WGSL,
} from './adaptiveErrorWgsl.ts'

type Level = (out: number[], inRes: number[], outRes: number[]) => number[]

/** The level a pixel makes from `texels`, a field a pixel (error, squared error, samples) laid out row by row `width` wide. */
const level = (texels: number[][], width: number): Level => {
  const run = shaderRun<{ ptAdaptiveErrorLevel: Level }>(
    PT_ADAPTIVE_ERROR_WGSL,
    ['ptAdaptiveErrorLevel'],
    {
      ptErrorInput: (c: number[]) => [...texels[c[1] * width + c[0]], 0],
    },
  )
  return run.ptAdaptiveErrorLevel
}

test('an even level averages four pixels and counts four times the samples', () => {
  const texels = [
    [1, 1, 2],
    [3, 9, 2],
    [5, 25, 2],
    [7, 49, 2],
  ]
  const out = level(texels, 2)([0, 0], [2, 2], [1, 1])
  assert.deepEqual(
    out.slice(0, 2).map((x) => +x.toFixed(6)),
    [4, 21],
  )
  assert.equal(out[2], 8)
})

test('an odd level shares its middle row and column: equal pixels stay equal and the samples add up to four times the mean', () => {
  const texels = Array.from({ length: 9 }, () => [2, 4, 1])
  const out = level(texels, 3)([0, 0], [3, 3], [1, 1])
  assert.deepEqual(
    out.slice(0, 2).map((x) => +x.toFixed(6)),
    [2, 4],
  )
  assert.equal(out[2], 4)
})

test('an odd level weighs each input pixel by the span of the output pixel it covers (the second of a pair by its own share)', () => {
  // Five inputs make two outputs: the second covers the inputs 2, 3 and 4 by one fifth, two fifths and two fifths.
  const texels = Array.from({ length: 25 }, (_, k) => [k % 5 === 3 ? 10 : 0, 0, 1])
  const out = level(texels, 5)([1, 1], [5, 5], [2, 2])
  assert.ok(Math.abs(out[0] - 4) < 1e-5)
})

test('pixels without samples make a pixel without samples, not a number that is not one', () => {
  const out = level(
    [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    2,
  )([0, 0], [2, 2], [1, 1])
  assert.deepEqual(out, [0, 0, 0, 0])
})

test('the kernel reads the level above and writes the one below', () => {
  assert.match(
    wgslSource(PT_ADAPTIVE_ERROR_KERNEL_WGSL),
    /ptAdaptiveErrorLevel\(out,ptLevels\.inRes,ptLevels\.outRes\)/,
  )
})

test('the kernel assembles: every name declared, none reserved, the entry present', () => {
  assertProgramAssembles(
    wgslSource(PT_ADAPTIVE_ERROR_KERNEL_WGSL),
    PT_ADAPTIVE_ERROR_ENTRY,
    'the error chain kernel',
  )
})
