// The disc drawn as a four-vertex strip (`DISC_TOPOLOGY`, `particlesWgsl.ts`) against the six-vertex
// list it replaced, on the shipped draw shader: the list's corners were (−1, −1), (1, −1), (−1, 1),
// then (−1, 1), (1, −1), (1, 1) — the strip's corners 0, 1, 2, 2, 1, 3, drawn indexed here. Hundreds
// of discs under a perspective view, overlapping, blended over each other and softened before the
// opaque depth that cuts through them, both blends: the lit image's halves equal, byte for byte —
// image class 1.
//
//   node bench/dawn/proofs.ts tests/gpu/particles/disc-strip.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { PARTICLE_FLOATS, ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts'
import {
  DISC_TOPOLOGY,
  DISC_VERTICES,
  PARTICLE_DRAW_WGSL,
  PARTICLE_STATE_HEAD,
} from '../../../packages/sdk-browser/src/particles/gpu/particlesWgsl.ts'
import {
  DRAW,
  DRAW_FLOATS,
  writeDrawWords,
  writeViewAxes,
} from '../../../packages/sdk-browser/src/particles/drawWords.ts'
import { particleTargets } from '../../../packages/sdk-browser/src/particles/particleTargets.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { bufferHolding, readTexture } from '../../kit/device/computeReadback.ts'
import { runOnDawn } from '../../kit/device/onDawn.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'

const SIDE = 128,
  DISCS = 400
/** Column-major, a reversed-depth perspective from (0, 0, 5) down −z, 90° wide. */
const VIEW_PROJ = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 5]
/** The camera's world matrix: a translation to (0, 0, 5). */
const WORLD = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1]
/** The opaque depth behind the discs, cleared once: reversed, `0.1 / distance`, the plane z = 0 five
 *  metres from the eye — the discs' cube straddles it, so a disc is whole, softened before it
 *  (`softness`) or hidden behind it. A depth of 0.5 would put the plane 0.2 m from the eye, every
 *  disc behind it and the image empty. */
const SCENE_DEPTH = 0.1 / 5
/** The list's corners as the strip names them. */
const LIST = new Uint16Array([0, 1, 2, 2, 1, 3])

type Blend = 'additive' | 'premultiplied'

/** The particles' state: the window — `DISCS` instances from slot 0 — then each disc alive, at a
 *  random place in a 2 m cube, of a random age and life, a radius of 0.15 m and a warm colour. */
function stateWords() {
  const next = lcgRandom(755),
    words = new ArrayBuffer(PARTICLE_STATE_HEAD + DISCS * PARTICLE_FLOATS * 4)
  new Uint32Array(words, 0, 8).set([DISC_VERTICES, DISCS])
  const slots = new Float32Array(words, PARTICLE_STATE_HEAD)
  for (let i = 0; i < DISCS; i++) {
    const life = 1 + next(),
      at = i * PARTICLE_FLOATS
    slots.set([next() * 2 - 1, next() * 2 - 1, next() * 2 - 1, next() * life * 0.9], at)
    slots.set([0, 0, 0, life], at + 4)
    slots.set([0.15, 0.15, 0, 0, 1, 0.8, 0.5, 1], at + 8)
  }
  return words
}

/** Each blend's lit image, drawn as the strip, then as the indexed list. */
async function draw(blends: Blend[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device } = gpu
  const { VERTEX, FRAGMENT } = GPUShaderStage
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: VERTEX | FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  })
  const module = device.createShaderModule({ code: PARTICLE_DRAW_WGSL })
  const state = bufferHolding(device, stateWords(), GPUBufferUsage.STORAGE),
    indices = bufferHolding(device, LIST, GPUBufferUsage.INDEX)
  const { RENDER_ATTACHMENT, COPY_SRC, TEXTURE_BINDING } = GPUTextureUsage
  const texture = (format: GPUTextureFormat, usage: number) =>
    device.createTexture({ size: [SIDE, SIDE], format, usage })
  const depth = texture('depth32float', RENDER_ATTACHMENT | TEXTURE_BINDING).createView()
  const images: Uint8Array[][] = []
  for (const blend of blends) {
    const pool = new ParticlePool({ capacity: DISCS, emitPerFrame: 1, blend, size: 0.15 })
    const words = new Float32Array(DRAW_FLOATS)
    writeViewAxes(words, WORLD)
    writeDrawWords(words, pool, VIEW_PROJ)
    words[DRAW.at.exposure] = words[DRAW.at.preExposure] = 1
    words.set([SIDE, SIDE], DRAW.at.drawn)
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: bufferHolding(device, words, GPUBufferUsage.UNIFORM) } },
        { binding: 1, resource: { buffer: state } },
        { binding: 2, resource: depth },
      ],
    })
    const targets = particleTargets(blend)
    for (const topology of [DISC_TOPOLOGY, 'triangle-list'] as const) {
      const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vs' },
        primitive: { topology },
        fragment: { module, entryPoint: 'fs', targets },
      })
      const drawn = targets.map(({ format }) => texture(format, RENDER_ATTACHMENT | COPY_SRC))
      const encoder = device.createCommandEncoder()
      encoder
        .beginRenderPass({
          colorAttachments: [],
          depthStencilAttachment: {
            ...{ view: depth, depthClearValue: SCENE_DEPTH },
            ...{ depthLoadOp: 'clear', depthStoreOp: 'store' },
          },
        })
        .end()
      const pass = encoder.beginRenderPass({
        colorAttachments: drawn.map((made) => ({
          view: made.createView(),
          loadOp: 'clear' as const,
          storeOp: 'store' as const,
        })),
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      if (topology === DISC_TOPOLOGY) pass.draw(DISC_VERTICES, DISCS)
      else {
        pass.setIndexBuffer(indices, 'uint16')
        pass.drawIndexed(LIST.length, DISCS)
      }
      pass.end()
      device.queue.submit([encoder.finish()])
      images.push(await Promise.all(drawn.map((made) => readTexture(device, made, 8))))
    }
  }
  const adapter = (await gpu.fermer()).court
  return {
    adapter,
    images: images.map((pair) => pair.map((bytes) => [...bytes])),
    errors: gpu.errors,
  }
}

test('the disc as a four-vertex strip draws the six-vertex list’s image, byte for byte', async () => {
  const blends: Blend[] = ['additive', 'premultiplied']
  const { adapter, images, errors } = await runOnDawn(draw, blends)
  assert.deepEqual(errors, [], `WebGPU errors on ${adapter}`)
  blends.forEach((blend, at) => {
    const [strip, list] = [images[2 * at], images[2 * at + 1]]
    assert.ok(
      strip[0].some((byte) => byte !== 0),
      `${blend}: the discs cover the image`,
    )
    strip.forEach((bytes, target) =>
      assert.deepEqual(bytes, list[target], `${blend}, target ${target}: a byte moved`),
    )
  })
})
