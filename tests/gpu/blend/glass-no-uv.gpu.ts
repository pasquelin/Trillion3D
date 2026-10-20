// A transmissive surface whose geometry has no texture coordinates is drawn, opened with the world
// or joining it, and the image keeps what lies behind it. A pictured glass joining a session that
// wore no picture turned the texture feedback on while the water pass was granted: the pass kept
// the pipelines of the variant without it, the device was lost and the whole image went
// (`followFeedback`, `../../../packages/sdk-browser/src/webgpu/blend/growth.ts`).
//
//   node bench/dawn/proofs.ts tests/gpu/blend/glass-no-uv.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { assertSoundProof, runPageProof, type PageProofResult } from '../kit/enginePageProof.ts'

test('a glass without texture coordinates is drawn, opened with the world or joining it', async () => {
  const page = resolve(import.meta.dirname, 'glassNoUvPage.ts')
  const result = (await runPageProof(page, 'glassNoUv')) as PageProofResult & {
    shares?: Record<string, number>
  }
  assertSoundProof(result)
  const shares = result.shares!
  for (const kind of ['ball', 'pictured ball', 'model']) {
    assert.ok(shares[kind] > 0.02, `${kind}: the row and the glass are drawn (${shares[kind]})`)
    assert.equal(shares[`${kind} joined`], shares[kind], `${kind}: joined, the same image`)
  }
})
