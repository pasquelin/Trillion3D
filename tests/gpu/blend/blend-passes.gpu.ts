// The WebGPU engine draws blended, masked and hidden surfaces as the host image needs
// (`blendPassesPage.ts`), on an opaque blue backdrop:
//
//  - two half-transparent tiles overlap: the nearer one's colour wins where they do, whichever it
//    is — the order of the passes follows depth, and changes the overlap;
//  - a blended tile keeps the backdrop it lies on: blue shows through the red;
//  - a double-sided blended tile seen from its back is drawn, a front-only one is not;
//  - a masked tile whose opacity passes its cutoff is opaque — its colour, none of the backdrop's —,
//    one whose opacity does not is not drawn at all;
//  - a hidden blended tile draws nothing.
//
//   node bench/dawn/proofs.ts tests/gpu/blend/blend-passes.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, publishAndVerify, type PageProofResult } from '../kit/enginePageProof.ts'
import type { Reading } from './blendPassesPage.ts'

type Result = PageProofResult & { redNear: Reading; greenNear: Reading }

test('blended, masked and hidden surfaces draw in their passes on WebGPU', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'blendPassesPage.ts'),
    'blendPasses',
  )) as Result
  publishAndVerify({ ...result, passes: { redNear: result.redNear, greenNear: result.greenNear } })
  const { redNear, greenNear } = result
  assert.ok(redNear.held && greenNear.held, 'both images are held')
  const red = redNear.at,
    green = greenNear.at
  // The nearer tile wins the overlap, and swapping which one is nearer swaps the winner.
  assert.ok(red.overlap[0] > red.overlap[1] + 20, `red nearer: ${red.overlap}`)
  assert.ok(green.overlap[1] > green.overlap[0] + 20, `green nearer: ${green.overlap}`)
  // Blending keeps the destination: the blue backdrop shows through the red tile.
  assert.ok(red.redOnly[0] > 60 && red.redOnly[2] > 30, `red over blue: ${red.redOnly}`)
  // Seen from its back, a double-sided tile is drawn; a front-only one leaves the backdrop bare.
  assert.notDeepEqual(red.doubleSided, red.bare, 'the back of a double-sided tile is not drawn')
  assert.deepEqual(red.frontOnly, red.bare, 'the back of a front-only tile is drawn')
  // Past its cutoff a masked tile is opaque: its red, none of the backdrop's blue.
  assert.ok(red.masked[0] > 200 && red.masked[2] < 40, `masked opaque: ${red.masked}`)
  assert.deepEqual(red.cut, red.bare, 'a masked tile under its cutoff is drawn')
  // A hidden source draws nothing.
  assert.deepEqual(red.hidden, red.bare, 'a hidden tile is drawn')
})
