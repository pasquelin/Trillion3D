// #1527: `world.raycast` is one GPU ray query over what the world draws (`webgpu/rays/`): each ray of
// a generated scene (`raycastPage.ts`) meets the object, at the distance, with the normal and on the
// triangle a double-precision oracle finds (`raycastOracle.ts`) — a morphed quad where its morph
// draws it, not where its rest pose lies; the helper mark and the hidden quad passed by, the helper
// met when asked; a filter's objects alone; a ray from inside the box; a ray that meets nothing. The
// faces are the drawn triangles: two rays share one exactly when the oracle's triangle is the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'

type Reading = {
  name: string
  got: { object: string; distance: number; normal: number[]; face: number } | null
  expected: { object: string; distance: number; normal: number[]; triangle: string } | null
}

test('every ray meets what the world draws, as the oracle finds it', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'raycastPage.ts'),
    'raycast',
  )) as PageProofResult & { readings: Reading[] }
  assertSoundProof(result)
  const faces = new Map<string, number>()
  for (const { name, got, expected } of result.readings) {
    if (!expected) {
      assert.equal(got, null, `${name}: nothing met`)
      continue
    }
    assert.ok(got, `${name}: a hit`)
    assert.equal(got.object, expected.object, `${name}: the object`)
    // The drawn corners are the quantized page's (a step of a cluster's box), placed in single
    // precision from the ray's origin: a millimetre bounds both on this scene of a few metres.
    const bound = 1e-3 + 1e-5 * expected.distance
    assert.ok(Math.abs(got.distance - expected.distance) <= bound, `${name}: the distance`)
    const along = got.normal.reduce((sum, n, k) => sum + n * expected.normal[k], 0)
    assert.ok(along >= 1 - 1e-4, `${name}: the normal`)
    const face = faces.get(expected.triangle)
    if (face !== undefined) assert.equal(got.face, face, `${name}: the same drawn triangle`)
    faces.set(expected.triangle, got.face)
  }
  // One drawn triangle a triangle of the oracle: two of its triangles never share a face.
  assert.equal(new Set(faces.values()).size, faces.size, 'distinct triangles, distinct faces')
})
