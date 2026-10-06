// Temporal antialiasing softens edges and nothing else (`temporalAntialiasingPage.ts`).
//
// A red tile rotated on a blue background, rendered by the real WebGPU engine. Without the option
// the image is the plain one. With it, the engine renders a full cycle of still frames before
// holding; the held image differs from the plain one only within two pixels of an edge — the reach
// of jitter and the filter —, surface interiors stay identical, two runs give the same image to the
// bit, a pan keeps the history, and a moved tile leaves no ghost where it was.
//
//   node bench/dawn/proofs.ts tests/gpu/taa/temporal-antialiasing.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  runPageProof as runPage,
  assertSoundProof as assertHealthy,
} from '../kit/enginePageProof.ts'
import { estRouge as isRed } from '../kit/sceneImageProof.ts'
import { changedPixels, nearEdge } from './antialiasingDiffs.ts'

type Held = { rendered: number[] | undefined; held: number[] | null; count: number }
type Run = {
  still: Held
  panned: number[]
  moved: Held
  capabilities: { temporalAntialiasing?: boolean; motionVectors?: string; unsupported?: string[] }
}
type Result = Awaited<ReturnType<typeof runPage>> & {
  viewport: [number, number]
  sans: Run
  with: Run
  witness: Run
}

/** Edge pixels in between — neither the tile's red nor the background: what smoothing leaves. */
function between(pixels: number[]) {
  let n = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i] > 200 && pixels[i + 2] < 80,
      background = pixels[i] < 60 && pixels[i + 2] > 60
    if (!red && !background) n++
  }
  return n
}

test('accumulation softens edges only, keeps its history under a pan, and leaves no ghost', async () => {
  const page = resolve(import.meta.dirname, 'temporalAntialiasingPage.ts')
  const result = (await runPage(page, 'temporalAntialiasing', 'run')) as Result
  assertHealthy(result)
  const [width, height] = result.viewport
  const { sans: plain, with: accumulated, witness } = result
  assert.equal(plain.capabilities?.temporalAntialiasing, false, 'without the option, no pass')
  assert.equal(accumulated.capabilities?.temporalAntialiasing, true, 'with it, the pass is wired')
  assert.equal(accumulated.capabilities?.motionVectors, 'derived')
  assert.ok(!accumulated.capabilities?.unsupported?.includes('temporal antialiasing'))
  for (const [name, run] of Object.entries({ plain, accumulated, witness })) {
    assert.ok(run.still.held, `${name}: never held while still, ${run.still.count} frames`)
    assert.ok(run.moved.held, `${name}: never held after the move, ${run.moved.count} frames`)
    // The held image is the one just rendered, shown again as it is.
    assert.deepEqual(run.still.held, run.still.rendered, `${name}: held ≠ rendered`)
  }
  // A full cycle of still frames precedes the hold with accumulation; without, it comes at once.
  assert.ok(plain.still.count <= 4, `without accumulation, held after ${plain.still.count}`)
  const cycle = accumulated.still.count
  assert.ok(cycle >= 16 && cycle <= 24, `with accumulation, held after ${cycle}; a cycle expected`)
  assert.deepEqual(witness.still.held, accumulated.still.held, 'two runs differ while still')
  assert.deepEqual(witness.moved.held, accumulated.moved.held, 'two runs differ after the move')

  // With versus without: edges change, the interior does not.
  for (const step of ['still', 'moved'] as const) {
    const changed = changedPixels(accumulated[step].held!, plain[step].held!, 2, width, height)
    assert.ok(changed.edges > 0, `${step}: accumulation changes no edge pixel`)
    assert.equal(changed.interior, 0, `${step}: ${changed.interior} interior pixels changed`)
  }

  // Under a pan the history must stay readable: reprojected askew, the clamp would reject it and
  // the moving image would fall back to the current frame alone, its edges hard. So the in-between
  // edge pixels of the moving image are counted against the still converged image's.
  const still = between(accumulated.still.held!),
    panned = between(accumulated.panned)
  assert.ok(still > 0, 'no in-between edge while still: accumulation smoothed nothing')
  assert.ok(panned >= 0.7 * still, `${panned} in-between edges panned, ${still} still`)

  // No ghost: where the tile was before the move and is not after it, the moved images with and
  // without accumulation both show the background, to 2 a channel.
  const before = plain.still.held!,
    after = plain.moved.held!,
    afterAccumulated = accumulated.moved.held!
  let ghosts = 0
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4
      // Red in the broad sense: an edge pixel counts as tile, so the whole freed region is read.
      if (!isRed(before, i) || isRed(after, i) || nearEdge(after, x, y, width, height)) continue
      if ([0, 1, 2].some((c) => Math.abs(afterAccumulated[i + c] - after[i + c]) > 2)) ghosts++
    }
  assert.equal(ghosts, 0, `${ghosts} pixels freed by the move keep a trace`)
})
