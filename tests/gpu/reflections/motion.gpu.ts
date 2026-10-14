// A moving view's reflection on the run-time proxy keeps what it showed: a pixel the frame's budget leaves
// out answers its surface's history, reprojected — never another surface's answer, the dark blocks a stale
// cell paints. Proved on cases of the generated family (`runtimeFamilyCases.ts`) over a mirror floor
// (`motionPath.ts`), drawn at a size whose rays outnumber the budget: the view settled, then panned and
// dollied, one pose an image. Each moving image is judged against the settled image of its pose
// (`judgeImage`, `motionGrid.ts`), past the first `SETTLING` images of each move and where it holds
// `JUDGED` bright pixels away from a body's edge: at most `BOUND` of them dark, under half the settled
// radiance. Each image prints the share of its judged pixels a hole, a carried history and a ray cast this
// image answered, and of its dark ones.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/motion.gpu.ts
//   TRILLION3D_CASE=<n> draws that case alone
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { MOVE_IMAGES } from './motionPath.ts'

/** The cases the proof moves through: the budget proof's, and two others of the family. */
const CASES = [25, 4, 18]
/** The share of the judged pixels an image may show dark: the ones a move uncovers and the budget has not
 *  reached yet. */
const BOUND = 0.05
/** Images of each move before the bound holds: the first after a still view reads its history. */
const SETTLING = 2
/** The bright pixels an image is judged on at least. */
const JUDGED = 40

const shares = (kinds: Record<string, number>, of: number) =>
  Object.fromEntries(
    Object.entries(kinds).map(([k, n]) => [k, of ? Number((n / of).toFixed(3)) : 0]),
  )

const only = process.env.TRILLION3D_CASE
for (const index of CASES)
  if (only === undefined || Number(only) === index)
    test(
      `case ${index}: a panned and dollied view keeps its mirror's reflection, no block dark`,
      { timeout: 900_000 },
      async () => {
        const page = (await loadPage(
          resolve(import.meta.dirname, 'motionPage.ts'),
          'reflectionMotion',
        )) as typeof import('./motionPage.ts')
        const result = await runOnDawn(page.run, { index, size: [1280, 720] as const })
        assert.equal(result.error, undefined, result.error)
        assert.deepEqual(result.errors, [])
        assert.deepEqual(result.worldErrors, [], "the world's own device raised no error")
        const { images = [] } = result
        assert.equal(images.length, 2 * MOVE_IMAGES)
        images.forEach((image, k) =>
          console.log(
            JSON.stringify({
              index,
              image: k,
              left: image.left,
              judged: image.judged,
              dark: Number(image.dark.toFixed(3)),
              answered: shares(image.all, image.judged),
              darkBy: shares(image.darkBy, image.judged),
            }),
          ),
        )
        const judged = images.filter(
          (image, k) => k % MOVE_IMAGES >= SETTLING && image.judged >= JUDGED,
        )
        const worst = Math.max(0, ...judged.map((image) => image.dark))
        console.log(JSON.stringify({ index, judgedImages: judged.length, worst }))
        assert.ok(
          images.some((image) => image.left > 0),
          'the budget is hit while the view moves: pixels answer their history',
        )
        assert.ok(judged.length > 0, 'an image of the move is judged')
        assert.ok(worst <= BOUND, `${worst} of the judged pixels dark at worst, the bound ${BOUND}`)
      },
    )
