// Proof P3 of #1527 on Dawn: the impostor card read through the tile pool, every tile resident,
// draws the image the card drew from its own textures. Nine cards over one image, each seen from
// another direction — another three frames, other weights — and at another level, fractions and
// one past the chain's last level included; the engine's card pipelines read the pool
// (`cardTileRig.ts`), the reference the three whole chains with the hardware sampler
// (`cardTilesReference.ts`). Both write the four surfaces, read back and compared at 8 bits.
import { length2, length3 } from '../../../packages/math/src/vector/vector.ts'
import { lend } from '../../../packages/sdk-browser/src/impostor/borrowed.ts'
import * as lent from '../../../packages/sdk-browser/src/webgpu/impostor/lent.ts'
import {
  cardPipelines,
  prepareImpostorPipelines,
} from '../../../packages/sdk-browser/src/webgpu/impostor/pipelines.ts'
import { SURFACE_FORMATS } from '../../../packages/sdk-browser/src/scene/surfaceBuffer.ts'
import { CARD_FLOATS } from '../../../packages/sdk-browser/src/impostor/cardSlots.ts'
import { bufferHolding, readTexture } from '../kit/computeReadback.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { viewUniform } from './cardIdRig.ts'
import { CARD_MAPS, cardTileAtlases, chainOf } from './cardTileRig.ts'
import { referenceGroup, referencePipelines } from './cardTilesReference.ts'
import { compareSurfaces, surfaceBytes } from './cardTilesCompare.ts'

const SIDE = 128,
  FRAMES = 4,
  FRAME_SIDE = 48,
  LEVELS = 3
/** Each card's levels: whole, between two, and one past the last (2), clamped as a sampler clamps. */
const LODS = [0, 0.25, 0.5, 0.75, 1, 1.4, 1.9, 2.5, 3.3]

/** The atlas's maps: in each frame a covered disc of colour gradients, a normal and depth that
 *  swing, and an ORM; any bytes do, as long as both reads read the same. */
const atlas = FRAMES * FRAME_SIDE
const inDisc = (x: number, y: number) =>
  length2((x % FRAME_SIDE) - FRAME_SIDE / 2, (y % FRAME_SIDE) - FRAME_SIDE / 2) < 20
const wave = (v: number) => Math.round(128 + 100 * Math.sin(v))
const maps = {
  colour: chainOf(atlas, LEVELS, (x, y) => [
    (x * 5) & 255,
    (y * 3 + x) & 255,
    wave(x * 0.21 + y * 0.13),
    inDisc(x, y) ? 255 : 0,
  ]),
  normalDepth: chainOf(atlas, LEVELS, (x, y) => [
    wave(x * 0.17),
    wave(y * 0.11),
    230,
    wave((x + y) * 0.05),
  ]),
  orm: chainOf(atlas, LEVELS, (x, y) => [wave(x * 0.07 + 1), wave(y * 0.09), (x * y) & 255, 255]),
}

/** Card `k` of a 3 × 3 grid at 5 m, turned about x and y by its own angles, of world radius 0.8,
 *  its texel depth set so the card pass reads level `LODS[k]` (`card_vs`: log2 of the distance less
 *  the texel depth, the view's focal logarithm zero). */
function records(device: GPUDevice) {
  const data = new Float32Array(CARD_FLOATS * LODS.length),
    radius = 0.8
  LODS.forEach((lod, k) => {
    const at = k * CARD_FLOATS,
      t = [((k % 3) - 1) * 1.8, (Math.floor(k / 3) - 1) * 1.8, -5]
    const [a, b] = [0.3 + 0.37 * k, 0.5 * k - 1.9],
      [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)]
    // The turn `Ry(b) Rx(a)`, by rows.
    const m = [
      [cb, sb * sa, sb * ca],
      [0, ca, -sa],
      [-sb, cb * sa, cb * ca],
    ]
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++) {
        data[at + 4 * c + r] = radius * m[r][c]
        data[at + 20 + 4 * c + r] = m[c][r] / radius
      }
    data.set([...t, 1], at + 12)
    data[at + 35] = 1
    data.set([1, FRAMES, 0, Math.log2(length3(t[0], t[1], t[2])) - lod], at + 36)
    data.set([0, 0, 0, radius], at + 40)
    data.set([...CARD_MAPS(0), 0], at + 44)
  })
  return bufferHolding(device, data, GPUBufferUsage.STORAGE)
}

type Stages = { vis: GPURenderPipeline; surface: GPURenderPipeline; maps: GPUBindGroup }

/** The cards drawn by `stages` — their visibility stage, then their surface stage —, the four
 *  surfaces read back. */
async function drawn(
  device: GPUDevice,
  stages: Stages,
  image: GPUBindGroup,
  ids: GPUBindGroupLayout,
) {
  const target = (format: GPUTextureFormat, extra = 0) =>
    device.createTexture({
      size: [SIDE, SIDE],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | extra,
    })
  const idTexture = target('r32uint', GPUTextureUsage.TEXTURE_BINDING),
    surfaces = SURFACE_FORMATS.map((format) => target(format))
  const encoder = device.createCommandEncoder()
  const clear = (texture: GPUTexture) => ({
    view: texture.createView(),
    loadOp: 'clear' as const,
    storeOp: 'store' as const,
    clearValue: [0, 0, 0, 0],
  })
  const visual = encoder.beginRenderPass({
    colorAttachments: [clear(idTexture), clear(target('r32float'))],
    depthStencilAttachment: {
      view: target('depth32float').createView(),
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
      depthClearValue: lent.DEPTH_CLEAR,
    },
  })
  visual.setPipeline(stages.vis)
  visual.setBindGroup(0, image)
  visual.setBindGroup(1, stages.maps)
  visual.draw(4, LODS.length)
  visual.end()
  const surface = encoder.beginRenderPass({ colorAttachments: surfaces.map(clear) })
  surface.setPipeline(stages.surface)
  surface.setBindGroup(0, image)
  surface.setBindGroup(1, stages.maps)
  surface.setBindGroup(
    2,
    device.createBindGroup({
      layout: ids,
      entries: [{ binding: 0, resource: idTexture.createView() }],
    }),
  )
  surface.draw(4, LODS.length)
  surface.end()
  device.queue.submit([encoder.finish()])
  return Promise.all(surfaces.map((texture, k) => readTexture(device, texture, surfaceBytes[k])))
}

export function runCardTiles() {
  return runOnDevice(async (device, events, result) => {
    lend(lent)
    const ok = await prepareImpostorPipelines(device, (phase, error) =>
      events.push({ phase, context: { reason: String(error) } }),
    )
    if (!ok) throw new Error('the card pipelines were refused')
    device.pushErrorScope('validation')
    const pipes = cardPipelines(device)
    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    })
    const tiles = cardTileAtlases(device, pipes.tilesLayout, sampler, {
      colours: [maps.colour],
      normalDepth: maps.normalDepth,
      orm: maps.orm,
    })
    const reference = await referencePipelines(device, pipes.imageLayout, pipes.idsLayout, LEVELS)
    const image = device.createBindGroup({
      layout: pipes.imageLayout,
      entries: [
        { binding: 0, resource: { buffer: viewUniform(device, 1) } },
        { binding: 1, resource: { buffer: records(device) } },
      ],
    })
    const pool = await drawn(
      device,
      { vis: pipes.visPipeline(true), surface: pipes.surfacePipeline(false), maps: tiles.group },
      image,
      pipes.idsLayout,
    )
    const chains = await drawn(
      device,
      {
        vis: reference.vis,
        surface: reference.surface,
        maps: referenceGroup(device, reference.tilesLayout, sampler, maps),
      },
      image,
      pipes.idsLayout,
    )
    const failure = await device.popErrorScope()
    if (failure) throw new Error(`validation: ${failure.message}`)
    tiles.destroy()
    Object.assign(result, { cards: LODS.length, ...compareSurfaces(pool, chains, SIDE * SIDE) })
  })
}
