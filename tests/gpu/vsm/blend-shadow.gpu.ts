// A blended surface's shadow is the opaque surface's: one estimator, the receiver's trace through
// the virtual shadow maps, evaluated by the projection pass for an opaque pixel and by the fragment
// for a blended one (`vsmTraceFactor`). The same receiver square, under the same wide sun and slats
// (`penumbraScene.ts`), drawn opaque, then blended at full opacity: the two images shade alike.
//
//   node bench/dawn/proofs.ts tests/gpu/vsm/blend-shadow.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, publishAndVerify, type PageProofResult } from '../kit/enginePageProof.ts'
import { luminance } from './shadowScene.ts'
import type { Shots } from './blendShadowPage.ts'

test('a blended receiver is shadowed as the opaque one, penumbra for penumbra', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'blendShadowPage.ts'),
    'blendShadow',
  )) as PageProofResult & Shots
  const { opaque, blend, open } = result
  publishAndVerify({ ...result, passes: {} })
  for (const [name, shot] of Object.entries({ opaque, blend, open }))
    assert.ok(shot.held && shot.pixels.length > 0, `${name}: not held`)
  const a = Uint8Array.from(opaque.pixels),
    b = Uint8Array.from(blend.pixels),
    o = Uint8Array.from(open.pixels)
  const pixels = a.length / 4
  let shaded = 0,
    apart = 0,
    sumA = 0,
    sumB = 0,
    worst = 0
  for (let i = 0; i < pixels; i++) {
    const la = luminance(a, i),
      lb = luminance(b, i)
    if (luminance(o, i) - la > 4) shaded++
    const d = Math.abs(la - lb)
    worst = Math.max(worst, d)
    if (d > 2) apart++
    sumA += la
    sumB += lb
  }
  console.log(
    JSON.stringify({ pixels, shaded, apart, worst, meanA: sumA / pixels, meanB: sumB / pixels }),
  )
  assert.ok(shaded > pixels / 2, `the slats shade the receiver: ${shaded} of ${pixels}`)
  assert.ok(apart <= pixels / 100, `${apart} pixels differ by more than two steps`)
  assert.ok(Math.abs(sumA - sumB) / pixels <= 0.5, 'the mean shading is the same')
})
