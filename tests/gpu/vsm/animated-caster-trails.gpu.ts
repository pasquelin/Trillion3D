// A lamp that moved leaves no trail in the shadow cache: the scene of the `keyframes-by-hand`
// example (a desk, a lamp of three joint groups, a shadow-casting room spot) reaches one final pose
// three ways, in a fresh world each — the mixer plays its clip and stops, a script writes the joints
// and the position frame by frame, the pose is set before the first frame — and after the same
// settle frames the three images must be the same one, to the 8-bit rounding. A pixel that differs
// is a shadow held from a pose the lamp has left. The page (`animatedCasterPage.ts`) prints the
// counts of differing pixels as JSON.
//
//   node bench/dawn/proofs.ts tests/gpu/vsm/animated-caster-trails.gpu.ts
//   node --experimental-strip-types --test tests/gpu/vsm/animated-caster-trails.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../../kit/device/onDawn.ts'

test('a caster that moved and stopped casts the shadow of a caster set there', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'animatedCasterPage.ts'),
    'vsmAnimatedCaster',
  )) as typeof import('./animatedCasterPage.ts')
  const pageErrors: string[] = []
  const read = await runOnDawn(page.run, undefined, pageErrors)
  console.log(JSON.stringify(read))
  assert.deepEqual([...(read.errors ?? []), ...pageErrors], [])
  assert.ok(
    read.drawn.fresh > 2000 && read.drawn.mixer > 2000 && read.drawn.script > 2000,
    `the scene is drawn: ${JSON.stringify(read.drawn)}`,
  )
  assert.notDeepEqual(read.firstPose, read.midPose, 'the clip moved the lamp')
  assert.equal(read.against.mixer.differing, 0, 'the mixer left no stale shadow')
  assert.equal(read.against.script.differing, 0, 'the script left no stale shadow')
})
