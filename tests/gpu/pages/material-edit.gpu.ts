// A material rewritten in place mid-run draws the image of a session opened on its new values
// (`materialEditPage.ts`), pixel for pixel: the opaque surface's colour and roughness are its one
// record in the material table, written alone — no page-table row goes up —; the glass's
// attenuation is its record too, its items and casters written again as a blended surface's are.
//
//   node bench/dawn/proofs.ts tests/gpu/pages/material-edit.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, publishAndVerify, type PageProofResult } from '../kit/enginePageProof.ts'
import type { Edits } from './materialEditPage.ts'

type Result = PageProofResult & Partial<Edits>

test('a material edited mid-run draws as a session opened on its values', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'materialEditPage.ts'),
    'materialEdit',
  )) as Result
  publishAndVerify({
    ...result,
    passes: { held: result.held, rows: [result.wallRows, result.glassRows] },
  })
  assert.deepEqual(result.held, [true, true, true], 'every image held')
  assert.equal(result.wallRows, 0, 'a colour and a roughness send no row up')
  assert.equal(result.wallDiffers, 0, 'the opaque edit is the fresh session’s image')
  assert.equal(result.glassDiffers, 0, 'the volume edit is the fresh session’s image')
})
