// A generated car driven over a generated terrain, its chase camera written ahead of each frame
// (`vehicleCadencePage.ts`), on a 120 Hz display the page plays, at a light GPU load and at a heavy
// one. Once the car is under way:
//
//  - steady intervals: the images are shown at one interval, the display's refresh or a steady
//    divisor of it (`frame/cadence.ts`), never one refresh and two in turn;
//  - smooth motion on screen: each image steps the world by the very time it is shown for (the
//    world's time on the display's grid, `worldFrameGrid.ts`), and the car's speed read from frame
//    to frame does not jump;
//  - the chase camera aims at the car as the frame draws it: written in `world.beforeFrame`, it
//    reads the pose this frame draws, never the last one's.
//
//   node bench/dawn/proofs.ts tests/gpu/frame/vehicleCadence.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { quantileOf } from '../../../packages/math/src/scalar/quantile.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'
import type { CadenceReading } from './vehicleCadencePage.ts'

/** The display time the car takes to get under way, refreshes of 120 Hz: two seconds. */
const UNDER_WAY = 240
/** The share of the images that must keep the one interval, and the world's step its time. */
const STEADY = 0.95

for (const pixelRatio of [1, 3])
  test(`a car driven over a terrain at a ratio of ${pixelRatio} is shown at a steady interval, moving smoothly`, async () => {
    const page = (await loadPage(
      resolve(import.meta.dirname, 'vehicleCadencePage.ts'),
      'vehicleCadence',
    )) as typeof import('./vehicleCadencePage.ts')
    const result = (await runOnDawn(page.run, {
      seconds: 6,
      pixelRatio,
    })) as Partial<CadenceReading> & {
      error?: string
      errors?: string[]
    }
    assert.equal(result.error, undefined, result.error)
    assert.deepEqual(result.errors, [])
    const frames = result.frames!.filter((frame) => frame.drawn >= UNDER_WAY)
    assert.ok(frames.length > 120, `${frames.length} frames under way`)
    assert.ok(result.speed! > 5, `driven: ${result.speed} m/s`)
    // Steady: one interval between the images shown.
    const intervals = frames.slice(1).map((frame, i) => Math.round(frame.shown - frames[i].shown))
    const counts = new Map<number, number>()
    for (const interval of intervals) counts.set(interval, (counts.get(interval) ?? 0) + 1)
    const [mode, kept] = [...counts].sort((a, b) => b[1] - a[1])[0]
    console.log(
      JSON.stringify({
        pixelRatio,
        intervals: Object.fromEntries(counts),
        gpuMs: quantileOf(
          frames.map((frame) => frame.gpu),
          0.5,
        ),
      }),
    )
    assert.ok(
      kept >= STEADY * intervals.length,
      `steady at ${mode}: ${kept} of ${intervals.length}`,
    )
    // Smooth: the world steps by the time each image is shown, to the display's grid.
    const REFRESH = page.REFRESH
    let matched = 0
    for (let i = 1; i < frames.length; i++) {
      const shownFor = (frames[i].shown - frames[i - 1].shown) * REFRESH
      if (Math.abs(frames[i].delta * 1000 - shownFor) < 1e-6) matched++
    }
    assert.ok(
      matched >= STEADY * (frames.length - 1),
      `the world's step is the time shown: ${matched} of ${frames.length - 1}`,
    )
    // The car's speed from frame to frame does not jump: a tenth at most from one image to the next.
    const speeds = frames.slice(1).map((frame, i) => {
      const [x, y, z] = frame.at.map((v, c) => v - frames[i].at[c])
      return length3(x, y, z) / frame.delta
    })
    let even = 0
    for (let i = 1; i < speeds.length; i++)
      if (Math.abs(speeds[i] / speeds[i - 1] - 1) <= 0.1) even++
    assert.ok(even >= STEADY * (speeds.length - 1), `even speed: ${even} of ${speeds.length - 1}`)
    // The chase camera aims at the car as drawn.
    const aim = Math.max(...frames.map((frame) => frame.aim))
    assert.ok(aim < 1e-4, `the camera aims at the drawn car: ${aim} rad off`)
  })
