// What the append-in-place proofs share on the test side: each case of a page is proved by running
// its method on Dawn, the added meshes appearing, the session never opened again, and the image
// the one of a world opened on all of them: the same bits, or within the 8-bit steps a proof's
// path bounds (`step`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  runPageProof,
  assertSoundProof,
  type PageProofResult,
} from '../../kit/device/enginePageProof.ts'

interface AppendResult extends PageProofResult {
  before?: string
  after?: string
  opened?: string | string[]
  sessions?: number[]
  apart?: Apart
}

/** The largest 8-bit step a channel of a joined session's image lies from the fresh open's. Not bit for
 *  bit: the reflections read the previous lit image (`litImage.ts`), so the image a session settles on
 *  is the fixed point of a feedback — the lit image reflected into the next one —, and the histories
 *  that blend it (exponential averages in the reference's short formats, their dither frozen at rest)
 *  come to rest on values their own past chose. The session that joins content starts those series from
 *  the image it held, the fresh open from its first: what is left between them tips a channel's 8-bit
 *  rounding, never by a whole step more. One step is that rounding; a pixel farther is a defect of the
 *  join. */
export const ONE_STEP = 1

/** How far apart two worlds' images lie (`apartOf`). */
export type Apart = { largest: number; texels: number; sizes: [number, number] }

/** The joined world's image lies within `step` 8-bit steps of the fresh open's, channel by channel. */
export function assertApart(apart: Apart | undefined, step = ONE_STEP) {
  assert.ok(apart && apart.sizes[0] > 0, 'an image was read')
  assert.equal(apart.sizes[0], apart.sizes[1], 'both images are the same size')
  assert.ok(
    apart.largest <= step,
    `a channel lies ${apart.largest} steps from the fresh open’s (${apart.texels} pixels apart)`,
  )
}

/** Registers a test for each `[name, method]` of the page `file` (beside the caller), proved under
 *  the global name `global`: the image the fresh open's bit for bit, or, with `step`, no channel of
 *  any pixel more than `step` 8-bit steps from it. */
export function appendCases(
  file: string,
  global: string,
  cases: readonly (readonly [string, string])[],
  step?: number,
) {
  const page = resolve(import.meta.dirname, file)
  for (const [name, method] of cases)
    test(`${name} joins the session in place and draws as a fresh open`, async () => {
      const result = (await runPageProof(page, global, method)) as AppendResult
      assertSoundProof(result)
      assert.notEqual(result.after, result.before, 'the added meshes appeared')
      assert.deepEqual(result.sessions, [1, 1], 'the session was never opened again')
      if (step === undefined) {
        assert.equal(result.after, result.opened, 'the image is the fresh open’s')
        return
      }
      assertApart(result.apart, step)
    })
}
