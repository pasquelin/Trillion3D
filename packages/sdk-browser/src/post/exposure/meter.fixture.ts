// What the tests of the meter share: the uniform the CPU writes for an image, the programs run in
// JavaScript over it and over a histogram, the writer's output for a sequence of images.
import assert from 'node:assert/strict'
import {
  EXPOSURE_HISTOGRAM_BUCKETS,
  EXPOSURE_RULES,
  type ExposureValues,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { exposureCurveTable } from '../../../../sdk-core/src/contracts/exposureCurveTable.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import type { SceneChain } from '../filters/sceneChain.ts'
import { METER_PARAMS, METER_WORDS, WEIGHT_ONE } from './meterLayout.ts'
import { luminanceReading, writeMeterParams } from './meterParams.ts'
import { meterWriter, startingRun, type MeterInput } from './meterRun.ts'
import { ADAPT_WGSL } from './meterWgsl.ts'

export const AT = METER_PARAMS.at
export const BUCKETS = EXPOSURE_HISTOGRAM_BUCKETS
export const NO_CURVE = exposureCurveTable(undefined)
export const settingsOf = (options: Partial<ExposureValues> = {}) =>
  ({ ...resolveSettings(EXPOSURE_RULES, {}), ...options }) as ExposureValues
export const within = (got: number, want: number, tolerance = 1e-6, label = '') =>
  assert.ok(
    Math.abs(got - want) <= tolerance * Math.max(1, Math.abs(want)),
    `${label} ${got} ≠ ${want}`,
  )

/** The words and the unsigned view of the uniform the CPU writes for an image. */
export function uniformOf(
  settings: ExposureValues,
  { size = [1920, 1080], seconds = 1 / 60, jumps = false, masked = false } = {},
) {
  const words = new Float32Array(METER_PARAMS.words),
    ints = new Uint32Array(words.buffer)
  writeMeterParams(words, ints, { settings, size, seconds, jumps, preExposure: 1, masked })
  return { words, ints }
}

/** The uniform's fields as the program's `meter` structure, each a vector of four. */
export const meterOf = ({ words, ints }: ReturnType<typeof uniformOf>) =>
  Object.fromEntries(
    Object.entries(AT).map(([name, at]) => [
      name,
      [...(name === 'size' ? ints : words).subarray(at, at + 4)],
    ]),
  )

/** The luminance of the histogram's bucket `bucket` under `settings`: what a pixel in it reads. */
export function bucketLuminance(settings: ExposureValues, bucket: number) {
  const { scale, bias } = luminanceReading(settings)
  return 2 ** ((bucket / (BUCKETS - 1) - bias) / scale)
}

/** The histogram words of `pixels` pixels all in bucket `bucket`. */
export function histogramIn(bucket: number, pixels = 1000) {
  const words = new Array<number>(METER_WORDS).fill(0)
  words[2 * bucket] = pixels * WEIGHT_ONE
  return words
}

/** The exposure buffer the meter starts from: an exposure of 1 asking 1, shown at 1. */
export const startingExposure = () => [
  [1, 1, 1, 1],
  [1, 1, Math.log2(0.18), 0],
  [1, 1, 0, 0],
]

/** Runs the update program over `uniform`, `histogram` and the compensation curve `table` and, in `scales`, the highlights' and the shadows' contrast curves', on
 *  `exposure`, which it writes. */
export function update(
  uniform: ReturnType<typeof uniformOf>,
  histogram: number[],
  exposure: number[][],
  table: ArrayLike<number> = NO_CURVE,
  scales: readonly [ArrayLike<number>, ArrayLike<number>] = [NO_CURVE, NO_CURVE],
) {
  // The compensation's table, then the two contrast curves'.
  const curve = Array.from({ length: 48 }, (_, i) =>
    [0, 1, 2, 3].map((k) => (i < 16 ? table[4 * i + k] : scales[i < 32 ? 0 : 1][4 * (i % 16) + k])),
  )
  shaderRun<{ adapt: () => void }>(ADAPT_WGSL, ['adapt'], {
    meter: meterOf(uniform),
    histogram,
    exposure,
    curve,
  }).adapt()
  return exposure
}

/** What the writer sent for each image: the uniform, as the words the GPU reads. */
export function writerOver(settings: ExposureValues) {
  const sent: Float32Array<ArrayBuffer>[] = []
  const device = {
    queue: { writeBuffer: (_: unknown, __: number, data: Float32Array) => sent.push(data.slice()) },
  } as unknown as GPUDevice
  const write = meterWriter(device, {} as GPUBuffer, startingRun())
  const image = (clock: number, cut: number | undefined = 0, over = settings): MeterInput => ({
    image: {} as GPUTextureView,
    scene: {} as SceneChain,
    size: [1920, 1080],
    settings: over,
    curve: NO_CURVE as Float32Array,
    cut,
    preExposure: 1,
    clock,
    mask: undefined,
  })
  const uniformAt = (k: number) => {
    const words = sent[k]
    return { words, ints: new Uint32Array(words.buffer) }
  }
  return { write, image, uniformAt, sent }
}

export const stops = (from: number, to: number) => Math.log2(from / to)
