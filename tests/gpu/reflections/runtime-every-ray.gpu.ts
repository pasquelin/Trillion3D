// Every ray of the run-time proxy is cast in its frame: at a size whose rays once outnumbered a frame's
// budget, no frame leaves a ray for a later one, so the view holds as soon as its image is final, and each
// frame's work — counted by the proof's own counter (`traceWork.ts`), the engine counting none — is what
// its pixels asked, `N·ū`, reported here for the recette (the image it holds is the one the family proof, `runtime-proxy.gpu.ts`, judges).
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/runtime-every-ray.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

/** Frames from the first that casts to the hold: the settle's own reads, never rays left for later. */
const HOLD_FRAMES = 12

test(
  'every frame casts every ray: the view holds once its image is final, and its work is reported',
  {
    timeout: 300_000,
  },
  async () => {
    const page = (await loadPage(
      resolve(import.meta.dirname, 'runtimeEveryRayPage.ts'),
      'reflectionEveryRay',
    )) as typeof import('./runtimeEveryRayPage.ts')
    const result = await runOnDawn(page.run, [1920, 1080] as const)
    assert.equal(result.error, undefined, result.error)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.worldErrors, [], "the world's own device raised no error")
    const { trail = [], held } = result
    const first = trail.findIndex((frame) => frame.spent > 0)
    const spent = trail.map((frame) => frame.spent).filter(Boolean)
    console.log(
      JSON.stringify({
        frames: trail.length,
        held,
        frames_cast: spent.length,
        unitsPerFrame: { worst: Math.max(...spent), first: spent[0] },
      }),
    )
    assert.ok(first >= 0, 'a frame casts the proxy rays')
    assert.ok(held, 'the view holds')
    assert.ok(
      trail.length - first <= HOLD_FRAMES,
      `${trail.length - first} frames from the first cast to the hold`,
    )
  },
)
