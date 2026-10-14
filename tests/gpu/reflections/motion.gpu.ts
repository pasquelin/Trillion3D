// A moving view's reflection on the run-time proxy keeps what it showed: a pixel the frame's budget leaves
// out answers its surface's history, reprojected — never another surface's answer, the dark blocks a stale
// cell paints. Proved on cases of the generated family (`runtimeFamilyCases.ts`) over a mirror floor
// (`motionPath.ts`), drawn at a size whose rays outnumber the budget: the view settled, then panned and
// dollied, one pose an image. At each image past the first `SETTLING` of each move, the floor's decided
// pixels (`expectedFloor`, the exact geometry at that pose) that must show a body's radiance are judged —
// on an image that holds `JUDGED` of them, and on half the images at least —: at most `BOUND` of them show
// under `DARK` of it.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/motion.gpu.ts
//   TRILLION3D_CASE=<n> draws that case alone
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { expectedFloor, TOLERANCE } from './runtimeFamilyExpect.ts'
import { MOVE_IMAGES, motionCase, motionPoses } from './motionPath.ts'

/** The cases the proof moves through: the budget proof's, and two others of the family. */
const CASES = [25, 4, 18]
/** The share of a body's radiance under which a pixel is dark. */
const DARK = 0.5
/** The share of the bright decided pixels an image may show dark: the ones a move uncovers and the budget
 *  has not reached yet. */
const BOUND = 0.05
/** Images of each move before the bound holds: the first after a still view reads its history. */
const SETTLING = 2
/** A pixel judged must show at least this: four times the family's absolute tolerance. */
const BRIGHT = 4 * TOLERANCE.absolute
/** The bright pixels an image is judged on at least. */
const JUDGED = 20

const only = process.env.TRILLION3D_CASE
for (const index of CASES)
  if (only === undefined || Number(only) === index)
    test(
      `case ${index}: a panned and dollied view keeps its mirror's reflection, no block dark`,
      { timeout: 600_000 },
      async () => {
        const page = (await loadPage(
          resolve(import.meta.dirname, 'motionPage.ts'),
          'reflectionMotion',
        )) as typeof import('./motionPage.ts')
        const result = await runOnDawn(page.run, { index, size: [1280, 720] as const })
        assert.equal(result.error, undefined, result.error)
        assert.deepEqual(result.errors, [])
        assert.deepEqual(result.worldErrors, [], "the world's own device raised no error")
        const { width = 0, height = 0, images = [] } = result
        const poses = motionPoses(motionCase(index))
        assert.equal(images.length, poses.length)
        const shares = images.map(({ samples }, k) => {
          let bright = 0,
            dark = 0
          for (const { index: at, expected } of expectedFloor(poses[k], width, height)) {
            const must = Math.max(...expected)
            if (must < BRIGHT) continue
            bright++
            const got = Math.max(samples[at * 3], samples[at * 3 + 1], samples[at * 3 + 2])
            if (got < DARK * must) dark++
          }
          return { bright, dark: bright ? dark / bright : 0 }
        })
        const judged = shares.filter((s, k) => k % MOVE_IMAGES >= SETTLING && s.bright >= JUDGED)
        const worst = Math.max(...judged.map((s) => s.dark))
        console.log(
          JSON.stringify({
            index,
            images: images.length,
            left: images.map((i) => i.left),
            dark: shares.map((s) => Number(s.dark.toFixed(3))),
            bright: shares.map((s) => s.bright),
            worst,
          }),
        )
        assert.ok(
          images.some((i) => i.left > 0),
          'the budget is hit while the view moves: pixels answer their history',
        )
        assert.ok(judged.length >= MOVE_IMAGES, `${judged.length} images judged`)
        assert.ok(worst <= BOUND, `${worst} of the bright pixels dark at worst, the bound ${BOUND}`)
      },
    )
