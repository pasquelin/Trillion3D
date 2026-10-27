// The per-light path (`shadowOnePassProjection: false`) lights a shadowed spot as the one-pass projection
// does. A box shadows a floor from one point spot, one ray a pixel, so that a pixel's share is 0 or 1;
// the page (`perLightShadowPage.ts`) draws it in three worlds and prints the readings as JSON.
//
// THE BOUND. Both paths trace the same light with the same rays, then store the share:
//   - the one-pass mask packs round(15 · share) in four bits (and dithers the share before: a share
//     between two sixteenths lands on either), so it holds a share to within 1/15;
//   - the per-light mask holds e = sqrt(share) in eight bits: ê = round(255 · e) / 255,
//     |ê − e| ≤ 1/510, and the lighting reads ê², so |ê² − share| = |ê − e| · (ê + e) ≤ 2/510 = 1/255.
// A share of 0 or 1 is held exactly by both (0 and 15/15; 0 and 255/255), and the light term after the
// mask is the same function (`declaredLight`) added in the same order (one light), so the images are
// one image: the bound is 0 levels, and one level is allowed for the order of the floating-point sums.
// A share strictly between 0 and 1 — a soft source, many rays — differs by at most 1/15 + 1/255 of the
// light's term, which the display curve then scales; it is the one-pass mask's four bits that set the
// bound, not the eight of the per-light mask.
//
//   node bench/dawn/proofs.ts tests/gpu/lighting/per-light-shadow.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../../kit/device/onDawn.ts'

/** Levels two images of hard shadows may differ by: the order of the sums. */
const BOUND_LEVELS = 1

test('a shadowed spot lit by its own draw is the image the one-pass projection draws', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'perLightShadowPage.ts'),
    'perLightShadow',
  )) as typeof import('./perLightShadowPage.ts')
  const pageErrors: string[] = []
  const read = await runOnDawn(page.run, undefined, pageErrors)
  console.log(JSON.stringify(read))
  assert.deepEqual([...(read.errors ?? []), ...pageErrors], [])
  // The shadow is there on both paths, and it is the same size.
  assert.ok(
    read.darkened.onePass > 200,
    `the one-pass shadow darkens pixels: ${read.darkened.onePass}`,
  )
  assert.ok(
    read.darkened.perLight > 200,
    `the per-light shadow darkens pixels: ${read.darkened.perLight}`,
  )
  assert.equal(read.darkened.perLight, read.darkened.onePass)
  assert.ok(
    read.against.maxChannelError <= BOUND_LEVELS,
    `images differ by ${read.against.maxChannelError}`,
  )
})
