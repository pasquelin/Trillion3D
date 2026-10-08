// The lit particle draw (#755, #833) on a real GPU, through the engine's own step and draw
// (`createWebgpuParticles`): one particle, a disc facing the eye, drawn into the lit image and the
// reactive value. Each pixel of the image holds the pool's colour times the disc's coverage — one
// less the squared corner, times the soft edge before the surface behind, its life left and its
// opacity —, nothing outside the disc; the additive blend leaves the image's alpha, the
// premultiplied one writes the coverage there; the reactive green is the coverage. The soft edge
// is read off the opaque depth: far behind, whole; a tenth of a metre behind a 0.2 m softness, half.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts'
import { createWebgpuParticles } from '../../../packages/sdk-browser/src/webgpu/particles/webgpuParticles.ts'
import { saturate } from '../../../packages/math/src/scalar/reals.ts'
import { readTexture } from '../kit/computeReadback.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

const SIDE = 32
/** Orthographic, column-major: x and y as they are; the depth reversed, the eye's plane z = 10 at
 *  1 and z = −10 at 0. */
const VIEW_PROJ = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 / 20, 0, 0, 0, 0.5, 1]
const EYE = [0, 0, 10]
const COLOR = [1, 0.5, 0.25, 0.8] as const,
  SIZE = 0.25,
  SOFTNESS = 0.2,
  LIFETIME = 0.25,
  STEP = 1 / 15

type Case = { blend: 'additive' | 'premultiplied'; depth: number }

/** A half float's value. */
function half(bits: number) {
  const exponent = (bits >> 10) & 31,
    fraction = bits & 1023,
    sign = bits & 0x8000 ? -1 : 1
  if (!exponent) return sign * fraction * 2 ** -24
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15)
}

/** Runs `attempt` until it reports done: the step and the draw compile off the thread, and the
 *  image waits for them. */
async function untilCompiled(attempt: () => boolean, what: string) {
  for (let tries = 0; !attempt(); tries++) {
    if (tries > 500) throw new Error(`the particle ${what} never compiled`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

/** Each case's one particle stepped once and drawn: the lit image's RGBA and the reactive green. */
async function drawLit(cases: Case[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device } = gpu
  const failures: string[] = []
  const particles = createWebgpuParticles(device, (error) => failures.push(String(error)))
  const { RENDER_ATTACHMENT, COPY_SRC, TEXTURE_BINDING } = GPUTextureUsage
  const texture = (format: GPUTextureFormat, usage: number) =>
    device.createTexture({ size: [SIDE, SIDE], format, usage })
  const images: { lit: number[]; reactive: number[] }[] = []
  for (const { blend, depth } of cases) {
    const pool = new ParticlePool({
      ...{ capacity: 64, emitPerFrame: 1, acceleration: [0, 0, 0], blend, color: COLOR },
      ...{ size: SIZE, softness: SOFTNESS },
    })
    pool.emit(0, 0, 0, 0, 0, 0, LIFETIME)
    pool.advance(STEP)
    await untilCompiled(() => {
      const encoder = device.createCommandEncoder()
      const stepped = particles.run([pool], encoder)
      device.queue.submit([encoder.finish()])
      return stepped > 0
    }, 'step')
    const lit = texture('rgba16float', RENDER_ATTACHMENT | COPY_SRC),
      reactive = texture('rg8unorm', RENDER_ATTACHMENT | COPY_SRC),
      depthTexture = texture('depth32float', RENDER_ATTACHMENT | TEXTURE_BINDING),
      depthView = depthTexture.createView()
    await untilCompiled(() => {
      const encoder = device.createCommandEncoder()
      encoder
        .beginRenderPass({
          colorAttachments: [lit, reactive].map((made) => ({
            view: made.createView(),
            loadOp: 'clear' as const,
            storeOp: 'store' as const,
          })),
          depthStencilAttachment: {
            ...{ view: depthView, depthClearValue: depth },
            ...{ depthLoadOp: 'clear', depthStoreOp: 'store' },
          },
        })
        .end()
      const drawn = particles.draw([pool], {
        encoder,
        target: lit.createView(),
        reactive: reactive.createView(),
        depth: depthView,
        size: [SIDE, SIDE],
        viewProj: VIEW_PROJ,
        eye: EYE,
      })
      device.queue.submit([encoder.finish()])
      return drawn > 0
    }, 'draw')
    const litBytes = await readTexture(device, lit, 8),
      halves = new Uint16Array(litBytes.buffer),
      greens = await readTexture(device, reactive, 2)
    images.push({
      lit: Array.from(halves, half),
      reactive: Array.from({ length: SIDE * SIDE }, (_, k) => greens[k * 2 + 1] / 255),
    })
    for (const made of [lit, reactive, depthTexture]) made.destroy()
  }
  particles.dispose()
  const adapter = (await gpu.fermer()).court
  return { adapter, images, errors: [...gpu.errors, ...failures] }
}

/** The rule at pixel `(x, y)`: the disc's coverage over the depth `depth` the image holds there. */
function coverage(x: number, y: number, depth: number) {
  const ndcX = ((x + 0.5) / SIDE) * 2 - 1,
    ndcY = 1 - ((y + 0.5) / SIDE) * 2
  const cx = ndcX / SIZE,
    cy = ndcY / SIZE
  if (Math.abs(cx) >= 1 || Math.abs(cy) >= 1) return 0
  const r2 = ndcX * ndcX + ndcY * ndcY,
    sceneZ = (depth - 0.5) * 20
  const behind = Math.sqrt(r2 + (sceneZ - EYE[2]) ** 2) - Math.sqrt(r2 + EYE[2] ** 2)
  const soft = saturate(behind / SOFTNESS),
    life = 1 - STEP / LIFETIME
  return Math.max(0, 1 - cx * cx - cy * cy) * soft * life * COLOR[3]
}

test('a lit particle covers its disc with its colour, fades before the surface behind, blends', async () => {
  const cases: Case[] = [
    { blend: 'additive', depth: 0 },
    { blend: 'premultiplied', depth: 0 },
    { blend: 'additive', depth: 0.495 },
  ]
  const { adapter, images, errors } = await runOnDawn(drawLit, cases)
  assert.deepEqual(errors, [], `WebGPU errors on ${adapter}`)
  cases.forEach(({ blend, depth }, at) => {
    const { lit, reactive } = images[at]
    let covered = 0
    for (let y = 0; y < SIDE; y++)
      for (let x = 0; x < SIDE; x++) {
        const k = coverage(x, y, depth),
          pixel = lit.slice((y * SIDE + x) * 4, (y * SIDE + x) * 4 + 4),
          where = `${blend} over depth ${depth}, pixel ${x}, ${y}`
        const expected = [COLOR[0] * k, COLOR[1] * k, COLOR[2] * k, blend === 'additive' ? 0 : k]
        pixel.forEach((value, c) =>
          assert.ok(Math.abs(value - expected[c]) < 3e-3, `${where}: ${pixel} vs ${expected}`),
        )
        assert.ok(Math.abs(reactive[y * SIDE + x] - k) <= 1 / 255 + 1e-6, `${where}: reactive`)
        if (k > 0) covered++
      }
    assert.ok(covered > 20, `${blend}: the disc covers ${covered} pixels`)
  })
  // Half the soft edge a tenth of a metre before the surface, whole far from it.
  const centre = (at: number) => images[at].lit[(16 * SIDE + 16) * 4]
  assert.ok(Math.abs(centre(2) / centre(0) - 0.5) < 0.02, 'the soft edge before the surface')
})
