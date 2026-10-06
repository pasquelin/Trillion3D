// `setTransform` resolves a node's parent BEFORE inverting its matrix, even when the host has
// written that parent's position, rotation and scale directly without ever calling
// `updateMatrixWorld` or going through `setTransform` again (`staleParentTransformPage.ts`).
// Without that resolution, the same world pose asked again after a dirty parent would land
// elsewhere — the inversion would bear on a stale world matrix. A singular parent (a zero scale)
// must refuse the request with `SINGULAR_PARENT_TRANSFORM` rather than silently pose sixteen zeros.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, publishAndVerify, type PageProofResult } from '../kit/enginePageProof.ts'

interface Pass {
  steps: { name: string; held: boolean }[]
  initialRed: number
  dirtyPixels: number
  settledPixels: number
  repeatPixels: number
  movedPixels: number
  singular: string
}

interface Result extends PageProofResult {
  passes: Record<string, Pass>
}

test('setTransform under a stale parent poses what it was asked, paged and unpaged', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'staleParentTransformPage.ts'),
    'staleParentTransform',
    'run',
  )) as Result
  publishAndVerify(result)
  for (const [pass, r] of Object.entries(result.passes)) {
    const say = (message: string) => `${pass}: ${message}`
    const held = (prefix: string) => r.steps.some((e) => e.name.startsWith(prefix) && e.held)
    assert.ok(r.initialRed > 0, say('the initial pose shows no red pixel'))
    assert.ok(held('initial-'), say('the initial image was never held'))
    assert.equal(
      r.steps.find((e) => e.name === 'parent-dirty')?.held,
      false,
      say('the dirty parent did not break the held image'),
    )
    assert.equal(r.dirtyPixels, 0, say('the same pose asked after a dirty parent draws elsewhere'))
    assert.ok(held('settled-'), say('the image never settled again'))
    assert.equal(r.settledPixels, 0, say('settling moved the held pose'))
    assert.equal(r.repeatPixels, 0, say('a second dirty then re-asked parent draws elsewhere'))
    assert.ok(r.movedPixels > 0, say('a truly different world pose changed nothing'))
    assert.equal(r.singular, 'SINGULAR_PARENT_TRANSFORM', say('the singular parent was accepted'))
  }
})
