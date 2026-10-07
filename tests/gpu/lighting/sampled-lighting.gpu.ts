// Sampled lighting converges, and a still image is the exact one.
//
// One lit square under eight contract lights of two colours, rendered by the real WebGPU engine.
// Still, the accumulated image equals the plain one inside the square: every light is shaded in
// full, and two runs give the same image to the bit. Under a sub-pixel camera shake every image
// moves and each pixel shades a drawn subset of its lights: the first moving image shows it — it
// leaves the still image by more than a hundredth of a pixel could move it —, and after a few more
// the history has averaged the draws back to the still image, within a declared tolerance.
//
//   node bench/dawn/proofs.ts tests/gpu/lighting/sampled-lighting.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts'
import {
  runPageProof as runPage,
  assertSoundProof as assertHealthy,
} from '../kit/enginePageProof.ts'

interface Run {
  held: number[] | null
  count: number
  heldWhileShaken: number
  first: number[]
  last: number[]
}
type Result = Awaited<ReturnType<typeof runPage>> & {
  viewport: [number, number]
  lights: number
  sans: Run
  with: Run
  witness: Run
}

/** The square's interior, three pixels inside its projected edge: the lit surface alone, away from
 *  what jitter and the current image's filter touch. */
const INTERIOR = [16, 80]

test('a still image shades every light, a moving one a drawn subset that history averages', async () => {
  const page = resolve(import.meta.dirname, 'sampledLightingPage.ts')
  const result = (await runPage(page, 'sampledLighting', 'run')) as Result
  assertHealthy(result)
  const [width] = result.viewport
  const { sans: plain, with: accumulated, witness } = result
  /** The largest channel difference of each interior pixel: its mean, and its maximum. */
  const interiorGap = (a: number[], b: number[]) => {
    let sum = 0,
      max = 0,
      n = 0
    for (let y = INTERIOR[0]; y < INTERIOR[1]; y++)
      for (let x = INTERIOR[0]; x < INTERIOR[1]; x++, n++) {
        const i = (y * width + x) * 4
        let d = 0
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]))
        sum += d
        max = Math.max(max, d)
      }
    return { mean: sum / n, max }
  }

  assert.ok(result.lights > LIGHT_SETTINGS.samplesPerPixel, 'the scene must exceed the samples')
  for (const [name, run] of Object.entries({ plain, accumulated, witness })) {
    assert.ok(run.held, `${name}: never held while still, ${run.count} frames rendered`)
    assert.equal(run.heldWhileShaken, 0, `${name}: a shaken image was held`)
  }
  const still = accumulated.held!
  assert.ok(
    accumulated.count >= 16,
    `with accumulation, held after ${accumulated.count} frames; a full cycle is expected`,
  )
  assert.deepEqual(witness.held, still, 'two identical runs differ while still')

  // Still, with versus without accumulation: the lit interior is the same image — every light of
  // the tile is shaded, exactly as without the option.
  const rest = interiorGap(still, plain.held!)
  assert.ok(rest.max <= 1, `still: an interior pixel differs by ${rest.max} from the plain image`)

  // Moving, the first image draws a subset of the lights in every pixel: the accumulated image
  // moves away from the still one by more than a hundredth of a pixel could move it.
  const first = interiorGap(accumulated.first, still)
  assert.ok(first.max >= 3, 'the moving image should shade a drawn subset of the lights')

  // After the shake, the history has averaged the draws: the interior is back on the still image
  // within four levels on average and thirty-two at worst — the declared grain of a moving image,
  // on a surface built so that two draws differ as much as they can, in chroma.
  const last = interiorGap(accumulated.last, still)
  assert.ok(last.mean <= 4, `mean interior difference ${last.mean.toFixed(2)} exceeds 4`)
  assert.ok(last.max <= 32, `an interior pixel differs by ${last.max}, more than 32`)
})
