import type { Texture } from '../../../../sdk-core/src/index.ts'
import { heldBuffers } from '../../gpu/core/heldBuffers.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { READBACK_IDLE_MS } from '../../gpu/core/heldReadback.ts'
import { sharedGpuDevice } from '../../gpu/core/sessionHandle.ts'
import { preparedComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { storageBufferCap, uniformStride } from '../../residency/pools.ts'
import { levelView, MATERIAL_MIP_FORMAT } from '../../texture/mips.ts'
import {
  TEXEL_FLIP,
  TEXEL_PREMULTIPLY,
  TEXEL_TURN_WGSL,
  TEXEL_TURN_WORKGROUP,
} from './texelTurnWgsl.ts'
import { textureRgba } from '../../visibility/types.ts'
import type { TileTexture } from './tileTexture.ts'

/**
 * RAW TEXELS TURNED ON THE GPU as their host texture asks (#362): rows reversed under `flipY` — the
 * picture's last row lands at v = 0 —, colour times alpha under `premultiplyAlpha`, round(byte ×
 * alpha / 255) in integers: the bytes are exactly those of the rule, whatever the texture's format,
 * no colour conversion on the way. The texels go up as they are into a staging RING of at most
 * `TURN_RING_BYTES`, and the kernel stores each turned texel straight into level 0 through the
 * texture's `rgba8unorm` storage view (a byte over 255 back to the same byte, as the mip kernels
 * store theirs): no rows buffer, no copy. A picture the ring holds is one write, one dispatch, one
 * submit; a larger one is turned a ring load at a time, each load submitted before the next is
 * written (the queue orders them), the last in the caller's encoder. The CPU touches no texel.
 */
const LABEL = 'Trillion3D texel turn'
/** Bytes the staging ring holds at most: device memory bounded whatever the picture (8 MiB for a
 *  1080p frame, 32 MiB a load for an 8K picture's 256 MiB). */
const TURN_RING_BYTES = 32 << 20

/** The device's one turn program: its layout, and its pipeline compiled off the thread before the
 *  first picture turns (`prepareTexelTurn`), else at once where it is used. */
const programOf = oncePerDevice((device: GPUDevice) => {
  const visibility = GPUShaderStage.COMPUTE
  const layout = device.createBindGroupLayout({
    label: LABEL,
    entries: [
      { binding: 0, visibility, buffer: { type: 'uniform' } },
      { binding: 1, visibility, buffer: { type: 'read-only-storage' } },
      {
        binding: 2,
        visibility,
        storageTexture: { access: 'write-only', format: MATERIAL_MIP_FORMAT },
      },
    ],
  })
  const pipeline = preparedComputePipeline(device, {
    label: LABEL,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ label: LABEL, code: TEXEL_TURN_WGSL }),
      entryPoint: 'main',
    },
  })
  return { layout, pipeline }
})

/** The turns host texture `map` asks of raw texels (`TEXEL_FLIP`, `TEXEL_PREMULTIPLY`), as bits. */
export const turnFlags = (map: Texture) =>
  (map.flipY ? TEXEL_FLIP : 0) | (map.premultiplyAlpha ? TEXEL_PREMULTIPLY : 0)

/** Compiles off the thread, before the first picture turns, the turn program when one of
 *  `textures` is a host texture of raw texels to flip or premultiply; resolves once it has, a
 *  refused one compiled where it is used. */
export function prepareTexelTurn(device: GPUDevice, textures: readonly TileTexture[]) {
  const turns = textures.some(
    ({ source }) => source.kind === 'host' && turnFlags(source.map) && textureRgba(source.map),
  )
  if (!turns) return Promise.resolve()
  return programOf(sharedGpuDevice(device))
    .pipeline.prepare()
    .then(
      () => {},
      () => {},
    )
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/**
 * The device's spare ring and words (`heldBuffers`), given back by a static picture's turn once its
 * first picture was submitted, and taken by the next turn: a burst of pictures at load allocates
 * them once — the larger of each kept —, never a ring of up to `TURN_RING_BYTES` made and destroyed
 * a texture. Destroyed once no turn gave any back for `READBACK_IDLE_MS`, the readback hold's idle
 * time (`heldReadback.ts`): a scene at rest holds no byte of them.
 */
const spares = heldBuffers(READBACK_IDLE_MS)
const SOURCE = `${LABEL} source`,
  WORDS = `${LABEL} words`

/** Rows of a band: as many as `bandBytes` holds, a multiple of the rows whose bytes land on the
 *  256-byte alignment a storage binding's offset asks; never under that multiple. */
function texelBandRows(width: number, height: number, bandBytes: number) {
  const row = width * 4,
    unit = 256 / gcd(row, 256)
  return Math.min(height, Math.max(unit, Math.floor(bandBytes / row / unit) * unit))
}

/** A turn's shape: the picture's size, the rows of a ring load, the loads, the uniform stride. */
type Bands = { width: number; height: number; band: number; bands: number; stride: number }

/** The shape of a `width × height` turn on `device`: ring loads of at most `bandBytes`, and of
 *  what a storage binding takes. */
function bandsOf(device: GPUDevice, width: number, height: number, bandBytes: number): Bands {
  const band = texelBandRows(width, height, Math.min(bandBytes, storageBufferCap(device.limits)))
  const stride = uniformStride(device.limits)
  return { width, height, band, bands: Math.ceil(height / band), stride }
}

/** What a turn holds between uploads: the words of every load, the ring, and a group a load. */
type TurnHold = { words: GPUBuffer; ring: GPUBuffer; groups: GPUBindGroup[] }

/** The words of every load for `flags`, into `packed`: load `b` lands at the rows its source rows
 *  turn to — from the top, or mirrored. Written word by word: nothing allocated a load. */
function turnBands(
  packed: Uint32Array,
  { width, height, band, bands, stride }: Bands,
  flags: number,
) {
  for (let b = 0; b < bands; b++) {
    const first = b * band,
      rows = Math.min(band, height - first),
      at = (b * stride) / 4
    packed[at] = width
    packed[at + 1] = rows
    packed[at + 2] = flags & TEXEL_FLIP ? height - first - rows : first
    packed[at + 3] = flags
  }
}

/** A turn's hold, its words and ring taken from the device's spares when they are large enough,
 *  a group a load binding its words, its rows of the ring, and level 0's storage view `level`. */
function takeHold(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  level: GPUTextureView,
  { width, height, band, bands, stride }: Bands,
): TurnHold {
  const row = width * 4
  const { UNIFORM, STORAGE, COPY_DST } = GPUBufferUsage
  const words = spares.take(device, WORDS, bands * stride, UNIFORM | COPY_DST),
    ring = spares.take(device, SOURCE, band * row, STORAGE | COPY_DST)
  const groups = Array.from({ length: bands }, (_, b) =>
    device.createBindGroup({
      label: LABEL,
      layout,
      entries: [
        { binding: 0, resource: { buffer: words, offset: b * stride, size: 16 } },
        { binding: 1, resource: { buffer: ring, size: Math.min(band, height - b * band) * row } },
        { binding: 2, resource: level },
      ],
    }),
  )
  return { words, ring, groups }
}

/** One ring load's turn: a dispatch over its `rows` rows of `width` texels, in `encoder`. */
function encodeBand(
  encoder: GPUCommandEncoder,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  width: number,
  rows: number,
) {
  const pass = encoder.beginComputePass({ label: LABEL })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(Math.ceil(width / TEXEL_TURN_WORKGROUP), rows)
  pass.end()
}

/** The turn of a `width × height` picture into level 0 of `texture` (`rgba8unorm`, storage
 *  usage), its words, ring and groups kept for every upload — a live texture turns each new picture
 *  with them — until `release`. `bandBytes` bounds a ring load (a proof's narrower loads). */
export function createTexelTurn(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  bandBytes = TURN_RING_BYTES,
) {
  const { layout, pipeline } = programOf(sharedGpuDevice(device))
  const shape = bandsOf(device, width, height, bandBytes),
    { band } = shape
  // In the texture's own `rgba8unorm`: its storage view.
  const level = levelView(texture, 0)
  const packed = new Uint32Array((shape.bands * shape.stride) / 4),
    row = width * 4
  let written = -1
  /** Taken at the first upload after a `release`. */
  let held: TurnHold | undefined
  return {
    /** Writes `texels`, `width × height` RGBA8 bytes, into level 0 as `flags` turn them
     *  (`TEXEL_FLIP`, `TEXEL_PREMULTIPLY`): a ring load a write and a dispatch, each submitted
     *  before the next load; the last in `encoder` when given — submitted by its owner. */
    upload(texels: Uint8Array, flags: number, encoder?: GPUCommandEncoder) {
      if (!held) {
        held = takeHold(device, layout, level, shape)
        written = -1
      }
      const { words, ring, groups } = held
      if (flags !== written) {
        turnBands(packed, shape, flags)
        device.queue.writeBuffer(words, 0, packed)
        written = flags
      }
      const picture = texels as Uint8Array<ArrayBuffer>,
        kernel = pipeline.get()
      for (let b = 0; b < shape.bands; b++) {
        const rows = Math.min(band, height - b * band),
          last = b === shape.bands - 1
        device.queue.writeBuffer(ring, 0, picture, b * band * row, rows * row)
        const own = last && encoder ? encoder : device.createCommandEncoder({ label: LABEL })
        encodeBand(own, kernel, groups[b], width, rows)
        if (own !== encoder) device.queue.submit([own.finish()])
      }
    },
    /** Gives the ring and its words back to the device's spares (a static picture, filled once,
     *  its first picture submitted); the next upload takes them again. */
    release() {
      if (held) {
        spares.give(device, SOURCE, held.ring, true)
        spares.give(device, WORDS, held.words, true)
      }
      held = undefined
    },
  }
}

export type TexelTurn = ReturnType<typeof createTexelTurn>
