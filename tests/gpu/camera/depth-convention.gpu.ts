// A clip convention the host declares changes nothing the engine draws: the same physical camera
// (near 2.8, far 12) and a tilted tile that crosses the near plane, rendered with no declared
// convention, then under WebGPU's `[0, 1]`, then with the declaration removed, give the same image
// pixel for pixel, both ways, paged and unpaged. The engine composes its own projection, in
// reversed depth and with an infinite far plane, so the declaration changes none of its numbers and
// the held image must stay held (`depthConventionPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, publishAndVerify } from '../kit/enginePageProof.ts'

interface Pass {
  frames: { name: string; held: boolean }[]
  red: number
  toWebgpu: number
  back: number
}

test('a host’s declared clip convention changes no pixel and drops no held image', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'depthConventionPage.ts'),
    'depthConvention',
    'runConventionFlip',
  )) as Parameters<typeof publishAndVerify>[0] & { passes: Record<string, Pass> }
  publishAndVerify(reading)
  for (const [pass, { frames, red, toWebgpu, back }] of Object.entries(reading.passes)) {
    const held = (name: string) => frames.find((frame) => frame.name === name)?.held
    assert.ok(red > 0, `${pass}: the tilted tile is not seen`)
    assert.ok(
      frames.some(({ name, held }) => name.startsWith('own-') && held),
      `${pass}: the image was never held`,
    )
    assert.equal(
      held('webgpu-0'),
      true,
      `${pass}: declaring WebGPU's convention recomputed the image`,
    )
    assert.equal(toWebgpu, 0, `${pass}: WebGPU's convention draws another image`)
    assert.equal(held('back-0'), true, `${pass}: removing the declaration recomputed the image`)
    assert.equal(back, 0, `${pass}: removing the declaration draws another image`)
  }
})
