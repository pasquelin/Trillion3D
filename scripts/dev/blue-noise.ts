/**
 * The engine's blue noise (`packages/sdk-browser/src/gpu/noise/blueNoiseSource.ts`): a spatiotemporal mask of 128 × 128 pixels and 64
 * frames, scalar and two-dimensional, made once and shipped as a file.
 *
 * The scalar mask is made by the void-and-cluster method with the spatiotemporal energy of Wolfe, Morrical, Akenine-Möller and
 * Ramamoorthi (2022): a first pattern of a tenth of the pixels, relaxed, then every pixel ranked by the order the largest voids
 * fill and the tightest clusters empty (`voidAndCluster.ts`). The two-dimensional mask is made by simulated annealing: uniform
 * vectors, two pixels' vectors swapped at random, the swap kept when it lowers the energy of the whole mask — in the first
 * hundredth of the run whatever it does, with the probability the temperature gives (`vectorAnnealing.ts`).
 *
 * Costs, on one core: the scalar mask about half a minute; the two-dimensional one 3.8 microseconds a swap, so that the run the method
 * is published with (1049 swaps a pixel, 1.1 billion swaps) takes about 70 minutes, and `--swaps-per-pixel 300` about 20 (a mask
 * annealed that long has under a thirtieth of white noise's power at its lowest frequencies).
 *
 * A cook tool, never loaded at run time: `node scripts/dev/blue-noise.ts [--out file] [--swaps-per-pixel n]` writes the file.
 */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { rankByte } from '../../packages/math/src/sequence/noiseEnergy.ts'
import {
  ANNEALING_DEFAULTS,
  annealVectors,
} from '../../packages/math/src/sequence/vectorAnnealing.ts'
import { voidAndCluster } from '../../packages/math/src/sequence/voidAndCluster.ts'
import {
  BLUE_NOISE_BYTES,
  BLUE_NOISE_PIXELS,
  BLUE_NOISE_VOLUME,
} from '../../packages/sdk-browser/src/gpu/noise/blueNoiseSource.ts'

/**
 * The file's bytes for a scalar mask's `ranks` (each pixel's place, `0 … count − 1`, in the order the masks fill) and a vector mask's
 * `vectors` (two values in [0, 1) a pixel): a rank stored as its share of 256, a value as its own, truncated.
 */
function packBlueNoise(ranks: Uint32Array, vectors: Float32Array) {
  const bytes = new Uint8Array(BLUE_NOISE_BYTES)
  for (let pixel = 0; pixel < BLUE_NOISE_PIXELS; pixel++) {
    bytes[pixel] = rankByte(ranks[pixel], BLUE_NOISE_PIXELS)
    for (let channel = 0; channel < 2; channel++)
      bytes[BLUE_NOISE_PIXELS + 2 * pixel + channel] = Math.min(
        255,
        Math.floor(vectors[2 * pixel + channel] * 256),
      )
  }
  return bytes
}

const DEFAULT_FILE = new URL(
  '../../packages/sdk-browser/src/gpu/noise/blueNoise.bin',
  import.meta.url,
)

const { values } = parseArgs({
  options: { out: { type: 'string' }, 'swaps-per-pixel': { type: 'string' } },
})
const out = values.out ?? DEFAULT_FILE
// The run's length is the published factor of the pixel count's square; the cooling keeps its share of the run.
const swapsPerPixel = values['swaps-per-pixel']
const swapCountFactor =
  swapsPerPixel === undefined
    ? ANNEALING_DEFAULTS.swapCountFactor
    : Number(swapsPerPixel) / BLUE_NOISE_PIXELS
const coolingFactor =
  (swapCountFactor * ANNEALING_DEFAULTS.coolingFactor) / ANNEALING_DEFAULTS.swapCountFactor

const seconds = (since: number) => ((performance.now() - since) / 1000).toFixed(0)
let start = performance.now()
const ranks = voidAndCluster(BLUE_NOISE_VOLUME)
process.stderr.write(`scalar mask: ${seconds(start)} s\n`)
start = performance.now()
const vectors = annealVectors(
  BLUE_NOISE_VOLUME,
  { ...ANNEALING_DEFAULTS, swapCountFactor, coolingFactor },
  (done, total) => process.stderr.write(`\rvector mask: ${((done / total) * 100).toFixed(1)} %`),
)
process.stderr.write(`\nvector mask: ${seconds(start)} s\n`)
writeFileSync(out, packBlueNoise(ranks, vectors))
