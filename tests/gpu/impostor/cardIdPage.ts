// The card pass on the engine's own pipelines (`prepareImpostorPipelines`), on Dawn: cards drawn
// into the visibility targets by their visibility stage, then into the surfaces by their surface
// stage, which keeps the pixels whose identifier is its own. The visibility stage is given a view
// whose depth differs from the surface stage's by 2⁻¹⁸ (thirty-two units in the last place of a
// single): the surface stage compares no depth, so the card must come out textured all the same.
import { lend } from '../../../packages/sdk-browser/src/impostor/borrowed.ts'
import * as lent from '../../../packages/sdk-browser/src/webgpu/impostor/lent.ts'
import {
  cardPipelines,
  prepareImpostorPipelines,
} from '../../../packages/sdk-browser/src/webgpu/impostor/pipelines.ts'
import { SURFACE_FORMATS } from '../../../packages/sdk-browser/src/scene/surfaceBuffer.ts'
import { VIS_CARD_BASE } from '../../../packages/sdk-browser/src/visibility/visWords.ts'
import { readTexture } from '../kit/computeReadback.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

import { DEPTH_SKEW, SIDE, atlasGroup, cardRecords, half, viewUniform } from './cardIdRig.ts'

/** What one pair of stages drew. */
type Drawn = {
  /** The identifier, the depth of the visibility stage and the surface colour, per texel. */
  ids: number[]
  depth: number[]
  colour: Array<[number, number, number]>
  written: boolean[]
}

/** The cards `cards`, each with the colour of its atlas, drawn in slot order by the visibility stage
 *  under `visSkew`, then by the surface stage under the true view. */
async function drawCards(
  device: GPUDevice,
  cards: Array<{ z: number; radius: number; colour: [number, number, number] }>,
  visSkew: number,
): Promise<Drawn> {
  device.pushErrorScope('validation')
  const pipes = cardPipelines(device)
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const records = cardRecords(device, cards)
  const atlases = cards.map(({ colour }) => atlasGroup(device, pipes.atlasLayout, sampler, colour))
  const imageGroup = (view: GPUBuffer) =>
    device.createBindGroup({
      layout: pipes.imageLayout,
      entries: [
        { binding: 0, resource: { buffer: view } },
        { binding: 1, resource: { buffer: records } },
      ],
    })
  const visImage = imageGroup(viewUniform(device, visSkew)),
    surfaceImage = imageGroup(viewUniform(device, 1))
  const target = (format: GPUTextureFormat, extra = 0) =>
    device.createTexture({
      size: [SIDE, SIDE],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | extra,
    })
  const ids = target('r32uint', GPUTextureUsage.TEXTURE_BINDING),
    hiz = target('r32float'),
    depth = target('depth32float')
  const surfaces = SURFACE_FORMATS.map((format) => target(format))
  const encoder = device.createCommandEncoder()
  const visual = encoder.beginRenderPass({
    colorAttachments: [
      { view: ids.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      { view: hiz.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
    ],
    depthStencilAttachment: {
      view: depth.createView(),
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
      depthClearValue: lent.DEPTH_CLEAR,
    },
  })
  visual.setPipeline(pipes.visPipeline(true))
  visual.setBindGroup(0, visImage)
  cards.forEach((_, slot) => {
    visual.setBindGroup(1, atlases[slot])
    visual.draw(4, 1, 0, slot)
  })
  visual.end()
  const draw = encoder.beginRenderPass({
    colorAttachments: surfaces.map((texture) => ({
      view: texture.createView(),
      loadOp: 'clear' as const,
      storeOp: 'store' as const,
      clearValue: [0, 0, 0, 0],
    })),
  })
  draw.setPipeline(pipes.pipeline)
  draw.setBindGroup(0, surfaceImage)
  draw.setBindGroup(
    2,
    device.createBindGroup({
      layout: pipes.idsLayout,
      entries: [{ binding: 0, resource: ids.createView() }],
    }),
  )
  cards.forEach((_, slot) => {
    draw.setBindGroup(1, atlases[slot])
    draw.draw(4, 1, 0, slot)
  })
  draw.end()
  device.queue.submit([encoder.finish()])
  const failure = await device.popErrorScope()
  if (failure) throw new Error(`validation: ${failure.message}`)
  const [idBytes, hizBytes, base, flags] = await Promise.all([
    readTexture(device, ids, 4),
    readTexture(device, hiz, 4),
    readTexture(device, surfaces[0], 8),
    readTexture(device, surfaces[3], 1),
  ])
  const words = new Uint32Array(idBytes.buffer),
    depths = new Float32Array(hizBytes.buffer),
    view = new DataView(base.buffer)
  const out: Drawn = { ids: [], depth: [], colour: [], written: [] }
  for (let texel = 0; texel < SIDE * SIDE; texel++) {
    out.ids.push(words[texel])
    out.depth.push(depths[texel])
    out.colour.push(
      [0, 2, 4].map((k) => half(view.getUint16(texel * 8 + k, true))) as [number, number, number],
    )
    out.written.push(flags[texel] !== 0)
  }
  return out
}

/** The linear value of an sRGB byte. */
const linear = (byte: number) => {
  const c = byte / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function runCardId() {
  return runOnDevice(async (device, events, result) => {
    lend(lent)
    const ok = await prepareImpostorPipelines(device, (phase, error) =>
      events.push({ phase, context: { reason: String(error) } }),
    )
    if (!ok) throw new Error('the card pipelines were refused')
    const orange: [number, number, number] = [255, 128, 0],
      blue: [number, number, number] = [0, 64, 255]
    const expected = (colour: [number, number, number]) => colour.map(linear)
    const centre = (SIDE / 2) * SIDE + SIDE / 2
    // One card, the visibility stage's depth skewed by 2⁻¹⁸ from the surface stage's.
    const one = await drawCards(device, [{ z: -3, radius: 1, colour: orange }], 1 + DEPTH_SKEW)
    const depth = one.depth[centre]
    // Two cards: the nearer, smaller one covers the middle of the farther, larger one.
    const two = await drawCards(
      device,
      [
        { z: -4, radius: 1.6, colour: orange },
        { z: -2, radius: 0.5, colour: blue },
      ],
      1 + DEPTH_SKEW,
    )
    const ring = (SIDE / 2) * SIDE + SIDE / 2 + 20
    Object.assign(result, {
      base: VIS_CARD_BASE,
      one: {
        id: one.ids[centre],
        depth,
        // The depth the surface stage would have rebuilt for the same pixel, and the rule the stage
        // had: its depth, nudged by 2⁻²⁰, no less than the one the visibility stage kept.
        rebuilt: depth / (1 + DEPTH_SKEW),
        colour: one.colour[centre],
        wanted: expected(orange),
        written: one.written.filter(Boolean).length,
        tagged: one.ids.filter((id) => id !== 0).length,
        outside: one.written[0] || one.colour[0].some((v) => v !== 0),
      },
      two: {
        middle: { id: two.ids[centre], colour: two.colour[centre], wanted: expected(blue) },
        ring: { id: two.ids[ring], colour: two.colour[ring], wanted: expected(orange) },
        written: two.written.filter(Boolean).length,
        tagged: two.ids.filter((id) => id !== 0).length,
      },
    })
  })
}
