// Raw texels turned on the GPU (#362, `texelTurn.ts`): on random RGBA8 pictures — one texel wide,
// odd, past one workgroup — and one holding every byte in every channel, each turn a host texture
// asks (rows reversed, colour times alpha, both) lands in level 0 exactly as the rule says, byte
// for byte, stored by the kernel through the `rgba8unorm` storage view: the rows in reverse order,
// `premultipliedByte` on every colour byte, the alpha kept; whole, and band by band.
//
//   node bench/dawn/proofs.ts tests/gpu/texture/texel-turn.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTexelTurn } from '../../../packages/sdk-browser/src/webgpu/tile/texelTurn.ts'
import {
  TEXEL_FLIP,
  TEXEL_PREMULTIPLY,
} from '../../../packages/sdk-browser/src/webgpu/tile/texelTurnWgsl.ts'
import { premultipliedByte } from '../../../bench/oracles/browser/cpu-image/math.ts'
import { readGpuImage } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { random } from '../../../packages/sdk-browser/src/page/cut/cutRuleChecks.fixture.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

type Case = { width: number; height: number; flags: number; band?: number; texels: number[] }

/** Each case's picture turned into an `rgba8unorm` texture, its level 0 read back row by row. */
async function turn(cases: Case[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device } = gpu
  const read: number[][] = []
  for (const { width, height, flags, band, texels } of cases) {
    const texture = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })
    const turned = createTexelTurn(device, texture, width, height, band)
    turned.upload(new Uint8Array(texels), flags)
    const rows = await readGpuImage(device, texture, width, height, undefined, { topDown: true })
    read.push(Array.from(rows))
    turned.release()
    texture.destroy()
  }
  const adapter = (await gpu.fermer()).court
  return { adapter, read, errors: gpu.errors }
}

/** The rule: row `y` of level 0 is source row `height - 1 - y` under a flip, each colour byte
 *  times its alpha under a premultiply. */
function expected({ width, height, flags, texels }: Case) {
  const row = width * 4,
    out: number[] = []
  for (let y = 0; y < height; y++) {
    const from = (flags & TEXEL_FLIP ? height - 1 - y : y) * row
    for (let x = from; x < from + row; x += 4) {
      const a = texels[x + 3]
      for (let c = 0; c < 3; c++)
        out.push(flags & TEXEL_PREMULTIPLY ? premultipliedByte(texels[x + c], a) : texels[x + c])
      out.push(a)
    }
  }
  return out
}

test('raw texels land flipped and premultiplied exactly as the rule says, whole or in bands', async () => {
  const next = random(362),
    cases: Case[] = []
  // Every byte in every channel: texel `i` of a 64 × 4 picture is (i, 255 − i, 7i, i) mod 256.
  const every = Array.from({ length: 256 }, (_, i) => [i, 255 - i, (7 * i) & 255, i]).flat()
  for (const [width, height] of [
    [1, 2],
    [3, 5],
    [64, 4],
    [65, 3],
    [96, 7],
  ])
    for (const flags of [TEXEL_FLIP, TEXEL_PREMULTIPLY, TEXEL_FLIP | TEXEL_PREMULTIPLY])
      // The device's band, and the narrowest the binding alignment allows: a row of 64 texels,
      // two of 96, the whole picture for the narrow ones.
      for (const band of [undefined, 1]) {
        const texels =
          width === 64
            ? every
            : Array.from({ length: width * height * 4 }, () => (next() * 256) | 0)
        cases.push({ width, height, flags, band, texels })
      }
  const { adapter, read, errors } = await runOnDawn(turn, cases)
  assert.deepEqual(errors, [], `WebGPU errors on ${adapter}`)
  cases.forEach((one, at) =>
    assert.deepEqual(read[at], expected(one), `${one.width}×${one.height}, turns ${one.flags}`),
  )
})
