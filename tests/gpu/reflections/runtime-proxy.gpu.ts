// A floor reflects the hidden side of an emissive sphere the image does not hold: the world cut the sphere
// at run time, no cooked proxy stands for it, and its own proxy (`runtimeProxyPage.ts`) answers where the
// screen cannot. The floor pixels whose mirror ray meets the sphere (`mirroredSphere`) show its emission —
// whole on a polished metal —, and none is a black disc. Two floors: the polished metal seen from above, and
// the rough dark paving seen steeply down, the pose at which the disc showed under a lamp's globe.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/runtime-proxy.gpu.ts
//   TRILLION3D_PROOF_PNG=<prefix> writes each image as <prefix>-<floor>.png
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encodePng } from '../../../packages/sdk-node/src/cutout/png.mts'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { FRAME_WORK } from '../../../packages/sdk-browser/src/bounce/runtimeLayout.ts'
import type { Kind } from './runtimeSceneFrame.ts'

const luma = (pixels: number[], at: number) =>
  0.2126 * pixels[at * 4] + 0.7152 * pixels[at * 4 + 1] + 0.0722 * pixels[at * 4 + 2]

/** What each floor shows of the sphere at its mirror pixels: the share of them that are dark (a black
 *  disc is nearly all of them) and the share that show the emission. */
const EXPECTED: Record<Kind, { dark: number; bright: number; threshold: number }> = {
  mirror: { dark: 0.02, bright: 0.95, threshold: 150 },
  paving: { dark: 0.02, bright: 0.85, threshold: 150 },
}

for (const kind of Object.keys(EXPECTED) as Kind[])
  test(
    `${kind}: the floor shows the sphere where only its hidden side is in the mirror ray`,
    { timeout: 300_000 },
    async () => {
      const page = (await loadPage(
        resolve(import.meta.dirname, 'runtimeProxyPage.ts'),
        'reflectionRuntime',
      )) as typeof import('./runtimeProxyPage.ts')
      const result = await runOnDawn(page.run, kind)
      assert.equal(result.error, undefined, result.error)
      assert.deepEqual(result.errors, [])
      assert.deepEqual(result.worldErrors, [], "the world's own device raised no error")
      const { pixels = [], mask = [], frames = 0, width = 0, height = 0 } = result
      const { frameMs = 0, spent = 0, left = 0, gpuFrameMs = 0, gpuTraceMs = 0 } = result
      const prefix = process.env.TRILLION3D_PROOF_PNG
      if (prefix)
        writeFileSync(
          `${prefix}-${kind}.png`,
          encodePng(
            width,
            height,
            Uint8Array.from(pixels.map((v, k) => ((k & 3) === 3 ? 255 : v))),
          ),
        )
      const { dark, bright, threshold } = EXPECTED[kind]
      const lit = mask.filter((at) => luma(pixels, at) >= threshold).length
      const black = mask.filter((at) => luma(pixels, at) < threshold / 2.5).length
      console.log(
        JSON.stringify({
          kind,
          frames,
          mask: mask.length,
          lit,
          black,
          frameMs,
          gpuFrameMs,
          gpuTraceMs,
          spent,
          left,
          budget: FRAME_WORK,
        }),
      )
      assert.ok(spent < FRAME_WORK && left === 0, `${spent} units spent, ${left} pixels left`)
      assert.ok(mask.length > 100, `${mask.length} floor pixels mirror the sphere`)
      assert.ok(black <= dark * mask.length, `${black} of ${mask.length} mirror pixels are dark`)
      assert.ok(
        lit >= bright * mask.length,
        `${lit} of ${mask.length} mirror pixels show the emission`,
      )
    },
  )
