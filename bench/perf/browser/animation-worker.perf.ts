// The animation samples taken ahead on a worker (`packages/sdk-browser/src/animation/animationAhead.ts`)
// against the synchronous WebAssembly sampler and Three's `AnimationMixer`, on the duel's scene
// (`support/animationRigs.ts`): 400 rigs of 25 bones, a position and a rotation track each, at a
// fixed step. What is timed is the main thread alone: `advanceMixers` (or Three's updates) per
// frame, and the thread's CPU per frame — the update, the timer, the worker's messages. Frames are
// paced by a timer, as a display's interval paces them, so the worker's buffer can come back; the
// three sides run in rounds whose order rotates, and each round's first frames, while the worker
// has nothing ready yet, are left out. The scene's poses through the worker are bit for bit the
// main thread's (`packages/sdk-browser/src/animation/animationAhead.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NodeDomWorker } from '../../oracles/browser/pageWorkNodeWorker.ts'
import { quantileOf } from '../../../packages/math/src/scalar/quantile.ts'
import { prepareSdkWasm } from '../../../packages/sdk-browser/src/wasm/sdkWasm.ts'
import { lendAnimationSampler } from '../../../packages/sdk-browser/src/animation/batchAnimation.ts'
import { sampleAhead } from '../../../packages/sdk-browser/src/animation/animationAhead.ts'
import { countingSampler } from '../../../packages/sdk-browser/src/animation/animationAhead.fixture.ts'
import {
  advanceMixers,
  lendActionSampler,
} from '../../../packages/sdk-core/src/world/animation/mixer.ts'
import { FRAME, animationRigs } from './support/animationRigs.ts'

await prepareSdkWasm(
  readFileSync(join(import.meta.dirname, '../../../packages/sdk-browser/src/wasm/kernels.wasm')),
)
const { sampler, counts: aheadCounts } = countingSampler((await lendAnimationSampler())!)
lendActionSampler(sampler)

/** Rounds of each side, frames a round, the first frames of a round left out, the pause between
 *  two frames: 24 rounds resolve 5 % on a loaded machine. */
const ROUNDS = 24,
  FRAMES = 32,
  WARM = 3,
  PAUSE_MS = 4

const { scene, mixersThree } = animationRigs()

const worker = new NodeDomWorker(
  new URL(
    '../../../packages/sdk-browser/src/animation/animationWorker.fixture.ts',
    import.meta.url,
  ),
)
const start = () => worker
const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
const cpu = () => {
  const used = process.threadCpuUsage()
  return used.user + used.system
}

/** Sync: the WebAssembly sampler on the main thread; ahead: the worker; three: Three. */
type Side = 'sync' | 'ahead' | 'three'
const updates: Record<Side, number[]> = { sync: [], ahead: [], three: [] }
const cpus: Record<Side, number[]> = { sync: [], ahead: [], three: [] }
async function round(side: Side) {
  sampleAhead(side === 'ahead' ? start : null)
  const frames: number[] = []
  let from = 0
  for (let f = 0; f < FRAMES; f++) {
    if (f === WARM) from = cpu()
    const t0 = performance.now()
    if (side === 'three') for (const mixer of mixersThree) mixer.update(FRAME)
    else advanceMixers(scene, FRAME)
    if (f >= WARM) frames.push((performance.now() - t0) * 1000)
    await pause()
  }
  updates[side].push(median(frames))
  cpus[side].push((cpu() - from) / (FRAMES - WARM))
}
const rank = (values: number[], q: number) => quantileOf(values, q) as number
const median = (values: number[]) => rank(values, 0.5)
const spread = (values: number[], digits = 0) =>
  `${median(values).toFixed(digits)} [${rank(values, 0.25).toFixed(digits)}–${rank(values, 0.75).toFixed(digits)}]`
const paired = (a: number[], b: number[]) => a.map((v, i) => v / b[i])

const SIDES: Side[] = ['sync', 'ahead', 'three']
// One round each to warm the JIT, the worker's module and its bindings.
for (const side of SIDES) await round(side)
for (const side of SIDES) updates[side].length = cpus[side].length = 0
const counted = { ...aheadCounts }
for (let r = 0; r < ROUNDS; r++)
  for (let s = 0; s < SIDES.length; s++) await round(SIDES[(r + s) % SIDES.length])
sampleAhead(null)
await worker.terminate()
const asked = aheadCounts.asked - counted.asked,
  taken = aheadCounts.taken - counted.taken

test('animation at a fixed step: the worker takes the sampling off the main thread', (t) => {
  const ahead = paired(updates.ahead, updates.sync),
    aheadCpu = paired(cpus.ahead, cpus.sync)
  t.diagnostic(
    `advanceMixers µs/frame (median [quartiles] of ${ROUNDS} rounds): sync ${spread(updates.sync)}, ` +
      `ahead ${spread(updates.ahead)}, Three ${spread(updates.three)}`,
  )
  t.diagnostic(
    `main-thread CPU µs/frame: sync ${spread(cpus.sync)}, ahead ${spread(cpus.ahead)}, ` +
      `Three ${spread(cpus.three)}`,
  )
  t.diagnostic(
    `paired ahead/sync: update ${spread(ahead, 3)}, CPU ${spread(aheadCpu, 3)}; ` +
      `vs Three: sync ${spread(paired(updates.sync, updates.three), 3)}, ` +
      `ahead ${spread(paired(updates.ahead, updates.three), 3)}; ` +
      `samples asked ${asked}, read from the worker ${taken}`,
  )
  // Every sample past a round's first frames is the worker's: the round's first frame asks.
  assert.ok(taken >= 0.9 * asked, `read from the worker ${taken} of ${asked}`)
  // Measured 0.55-0.68 (quartiles, Oct. 2026, load 4-8): a ceiling well above, below 1.
  assert.ok(median(ahead) < 0.9, `ahead/sync ${median(ahead).toFixed(3)}, above 0.9`)
  assert.ok(median(aheadCpu) < 0.9, `ahead/sync CPU ${median(aheadCpu).toFixed(3)}, above 0.9`)
})
