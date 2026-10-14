// A frame spends at most its budget on the run-time proxy's rays, and the rays it leaves out go on in the
// next frames from the answers the pixels last got: at a size whose rays outnumber the budget, the first
// frames leave pixels (`left`), the view settles once none is left (the image it holds is the one the
// family proof, `runtime-proxy.gpu.ts`, judges).
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/runtime-budget.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { FRAME_WORK } from '../../../packages/sdk-browser/src/bounce/runtimeLayout.ts'

test(
  'a frame past its budget leaves its rays for the next frames, and the view settles on the full answer',
  {
    timeout: 300_000,
  },
  async () => {
    const page = (await loadPage(
      resolve(import.meta.dirname, 'runtimeBudgetPage.ts'),
      'reflectionBudget',
    )) as typeof import('./runtimeBudgetPage.ts')
    const result = await runOnDawn(page.run, [1920, 1080] as const)
    assert.equal(result.error, undefined, result.error)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.worldErrors, [], "the world's own device raised no error")
    const { trail = [], held } = result
    const cast = trail.filter((frame) => frame.spent > 0)
    console.log(
      JSON.stringify({
        frames: trail.length,
        held,
        trail: cast.slice(0, 6),
        frames_cast: cast.length,
        budget: FRAME_WORK,
      }),
    )
    assert.ok(
      cast.length > 0 && cast[0].left > 0,
      'the first frame that casts leaves rays for later: the budget is hit',
    )
    assert.ok(held, 'the view holds once the rays are all answered')
    assert.equal(trail.at(-1)!.left, 0, 'none is left when it holds')
    const worst = Math.max(...trail.map((frame) => frame.spent))
    assert.ok(worst < 2.2 * FRAME_WORK, `${worst} units a frame, the budget ${FRAME_WORK}`)
  },
)
