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
import { CARD_VIEW_FLOATS } from '../../../packages/sdk-browser/src/webgpu/impostor/cardWgsl.ts'
import { CARD_FLOATS } from '../../../packages/sdk-browser/src/impostor/cardSlots.ts'
import { SURFACE_FORMATS } from '../../../packages/sdk-browser/src/scene/surfaceBuffer.ts'
import { VIS_CARD_BASE } from '../../../packages/sdk-browser/src/visibility/visWords.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

const SIDE = 64,
  FRAMES = 4,
  ATLAS = 16
/** The card is turned about x so that the eye, in its object space, looks from above: inside the upper
 *  hemi-octahedron the atlas covers, whose frames' planes the eye's ray crosses. */
const TURN = (-40 * Math.PI) / 180
/** The depth the visibility stage's view is given beyond the surface stage's: 2⁻¹⁸ of it. */
export const DEPTH_SKEW = 2 ** -18

/** Perspective of 60° and an aspect of one, reversed depth with an infinite far plane (clip z is the
 *  near distance, clip w the distance): a point at distance d reads depth near / d, nearer larger.
 *  Column-major. `skew` scales the clip z alone, as a compiler rounding the depth apart would. */
function projection(skew: number) {
  const f = 1 / Math.tan(Math.PI / 6),
    near = 0.1
  return [f, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near * skew, 0]
}

/** A view uniform (`CardView`): the view-projection and the camera's own — one, the camera at the
 *  origin and turned to −z —, the eye split in two singles (zero), the focal length's logarithm. */
function viewUniform(device: GPUDevice, skew: number) {
  const data = new Float32Array(CARD_VIEW_FLOATS)
  data.set(projection(skew), 0)
  data.set(projection(1), 16)
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, data)
  return buffer
}

/** The records of cards at `centres` (z, radius), each a mesh of unit object radius whose pivot is
 *  its origin: the world is `radius`, the translation `(0, 0, z)`. */
function cardRecords(device: GPUDevice, cards: Array<{ z: number; radius: number }>) {
  const data = new Float32Array(CARD_FLOATS * cards.length)
  cards.forEach(({ z, radius }, slot) => {
    const at = slot * CARD_FLOATS
    const c = Math.cos(TURN),
      sn = Math.sin(TURN)
    // The world is the turn's transpose scaled by the radius, translated; the inverse its opposite.
    data.set(
      [radius, 0, 0, 0, 0, radius * c, -radius * sn, 0, 0, radius * sn, radius * c, 0, 0, 0, z, 1],
      at,
    )
    data.set(
      [
        1 / radius,
        0,
        0,
        0,
        0,
        c / radius,
        sn / radius,
        0,
        0,
        -sn / radius,
        c / radius,
        0,
        0,
        0,
        0,
        1,
      ],
      at + 20,
    )
    // Object radius, frames a side, the upper hemi-octahedron, a texel depth that asks mip 0.
    data.set([1, FRAMES, 1, 8], at + 36)
    data.set([0, 0, 0, radius], at + 40)
  })
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, data)
  return buffer
}

/** An atlas of one colour in all its frames: the colour and coverage (sRGB), a flat normal at the
 *  middle depth, the packed ORM. */
function atlasGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sampler: GPUSampler,
  colour: [number, number, number],
) {
  const make = (format: GPUTextureFormat, texel: number[]) => {
    const texture = device.createTexture({
      size: [ATLAS, ATLAS],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    const bytes = new Uint8Array(ATLAS * ATLAS * 4)
    for (let i = 0; i < ATLAS * ATLAS; i++) bytes.set(texel, i * 4)
    device.queue.writeTexture({ texture }, bytes, { bytesPerRow: ATLAS * 4 }, [ATLAS, ATLAS])
    return texture.createView()
  }
  return device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: make('rgba8unorm-srgb', [...colour, 255]) },
      { binding: 1, resource: make('rgba8unorm', [128, 128, 255, 128]) },
      { binding: 2, resource: make('rgba8unorm', [255, 128, 0, 255]) },
      { binding: 3, resource: sampler },
    ],
  })
}

/** Half-float to number. */
function half(bits: number) {
  const exponent = (bits >> 10) & 31,
    fraction = bits & 1023,
    sign = bits & 0x8000 ? -1 : 1
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 31) return fraction ? NaN : sign * Infinity
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

/** `texture`, read whole: `SIDE × SIDE` texels of `bytes` bytes. */
async function readTexture(device: GPUDevice, texture: GPUTexture, bytes: number) {
  const row = Math.ceil((SIDE * bytes) / 256) * 256
  const buffer = device.createBuffer({
    size: row * SIDE,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: row }, [SIDE, SIDE])
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(GPUMapMode.READ)
  const copy = new Uint8Array(buffer.getMappedRange().slice(0))
  buffer.unmap()
  buffer.destroy()
  return { bytes: copy, row }
}

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
  const at = (x: number, y: number, read: { row: number }, bytes: number) =>
    y * read.row + x * bytes
  const out: Drawn = { ids: [], depth: [], colour: [], written: [] }
  for (let y = 0; y < SIDE; y++)
    for (let x = 0; x < SIDE; x++) {
      out.ids.push(new Uint32Array(idBytes.bytes.buffer)[at(x, y, idBytes, 4) / 4])
      out.depth.push(new Float32Array(hizBytes.bytes.buffer)[at(x, y, hizBytes, 4) / 4])
      const view = new DataView(base.bytes.buffer)
      const o = at(x, y, base, 8)
      out.colour.push(
        [0, 2, 4].map((k) => half(view.getUint16(o + k, true))) as [number, number, number],
      )
      out.written.push(flags.bytes[at(x, y, flags, 1)] !== 0)
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
