import { mipSize } from '../../../../math/src/scalar/integers.ts'
import {
  ambientCubemapColour,
  isAmbientCubemapActive,
  readAmbientCubemapSetting,
} from '../../../../sdk-core/src/contracts/ambientCubemapOptions.ts'
import {
  ambientCubemapMipRows,
  prepareAmbientCubemap,
  preparedMipCount,
  type PreparedAmbientCubemap,
} from '../../../../sdk-core/src/lighting/ambientCubemapMips.ts'
import type { SkyLightCubemap } from '../../../../sdk-core/src/modules/sky/skyLightCubemap.ts'
import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { rgbToHalfRgba } from '../../gpu/core/halfTexels.ts'
import { cubemapPairFit, openSkyCubemap } from '../../modules/sky/skyLight/cubemap.ts'

/**
 * THE AMBIENT CUBEMAP OF AN IMAGE: the cube the host gave (`EngineContext.ambientCubemap`) as a texture with its mip chain, the colour
 * its light is multiplied by, and whether the image has the light at all (`ContractKey.cubeless`). The indirect pass reads it
 * (`ambientCubemapWgsl.ts`).
 *
 * The chain is filtered by angle on the CPU (`ambientCubemapMips.ts`: the sky light's own filter is a convolution by the GGX
 * lobe of a roughness, another kernel), rows by rows within a time budget an image (`MS_PER_IMAGE`), uploaded as half floats and
 * kept while the data is the same; a cube brighter than a half float holds is rescaled and the light given the inverse
 * (`cubemapPairFit`), so nothing is clamped. The cube is the light's only once the chain is whole: the images drawn meanwhile are
 * drawn again (`ambientCubemapPending`), never held, and light nothing from it.
 */

/** The time the filter spends on the chain in one image, at least one chunk of rows past it. */
const MS_PER_IMAGE = 2

/** The texels filtered between two looks at the clock: a row of the finer mips, several of the coarser. */
const CHUNK_TEXELS = 512

/** `GPUBufferUsage.UNIFORM` and `.COPY_DST`, written in the clear: the layout is also read from Node. */
const UNIFORM = 64,
  BUFFER_COPY_DST = 8

/** The cube held: its data, the chain made ready, the texture and the next rows of the next mip to write. */
interface HeldCube {
  readonly data: SkyLightCubemap
  readonly prepared: PreparedAmbientCubemap
  readonly texture: GPUTexture
  readonly view: GPUTextureView
  /** The cube was multiplied by `fit.cube` to fit a half float; the light is multiplied by `light`. */
  readonly cube: number
  readonly light: number
  /** One chunk's filtered numbers and half floats, reused. */
  readonly numbers: Float32Array<ArrayBuffer>
  readonly halves: Uint16Array<ArrayBuffer>
  level: number
  face: number
  row: number
}

/** What the runtime keeps of the ambient cubemap. */
export interface AmbientCubemapFrame {
  /** The cube the settings last read named, and the four settings (tint red, green, blue, intensity) it was read with. */
  cube: SkyLightCubemap | undefined
  readonly settings: Float64Array
  /** Whether the image has the light: a cube, and a colour that is not black. */
  on: boolean
  /** The colour, tint times intensity. */
  rgb: readonly number[]
  held?: HeldCube
  colour?: GPUBuffer
  /** The colour as last written to the buffer, times the light's unit. */
  readonly written: Float32Array<ArrayBuffer>
  /** Whether the chain is still being written. */
  pending: boolean
}

type Rt = WebgpuPagesRuntime

const FIELDS = [
  'ambientCubemapTintRed',
  'ambientCubemapTintGreen',
  'ambientCubemapTintBlue',
  'ambientCubemapIntensity',
] as const

/** The frame state of `rt`, its settings read again: the colour and whether the image has the light are worked out when a setting or the cube moved. */
function follow(rt: Rt) {
  const frame = (rt.lights.ambientCubemap ??= {
    cube: undefined,
    settings: new Float64Array(FIELDS.length).fill(Number.NaN),
    on: false,
    rgb: [0, 0, 0],
    written: new Float32Array(4),
    pending: false,
  })
  const cube = rt.context.ambientCubemap ?? undefined
  let moved = cube !== frame.cube
  for (let i = 0; i < FIELDS.length; i++) {
    const value = readAmbientCubemapSetting(rt, FIELDS[i])
    if (value !== frame.settings[i]) {
      frame.settings[i] = value
      moved = true
    }
  }
  if (moved) {
    frame.cube = cube
    const [red, green, blue, intensity] = frame.settings
    const values = {
      ambientCubemapTintRed: red,
      ambientCubemapTintGreen: green,
      ambientCubemapTintBlue: blue,
      ambientCubemapIntensity: intensity,
      ambientCubemap: cube,
    }
    frame.rgb = ambientCubemapColour(values)
    frame.on = isAmbientCubemapActive(values)
  }
  return frame
}

/** Whether the image has the ambient cubemap's light: the lit programs hold the cube code then (`ContractKey.cubeless`). */
export const ambientCubemapOn = (rt: Rt) => follow(rt).on

/** Whether the chain is still being written: the image drawn meanwhile is drawn again (`holdWebgpuFrame`). */
export const ambientCubemapPending = (rt: Rt) => rt.lights.ambientCubemap?.pending === true

/** The texture of `data` with its chain, none of its rows written yet. */
function open(device: GPUDevice, data: SkyLightCubemap): HeldCube {
  const prepared = prepareAmbientCubemap(data)
  const fit = cubemapPairFit(data)
  const { texture } = openSkyCubemap(
    device,
    data,
    fit,
    'Trillion3D ambient cubemap',
    preparedMipCount(prepared),
  )
  const chunk = Math.max(CHUNK_TEXELS, data.size)
  return {
    data,
    prepared,
    texture,
    view: texture.createView({ dimension: 'cube' }),
    cube: fit.cube,
    light: fit.light,
    numbers: new Float32Array(chunk * 3),
    halves: new Uint16Array(chunk * 4),
    level: 0,
    face: 0,
    row: 0,
  }
}

/** The next rows of the chain filtered and written, within the budget of this image and at least one chunk; true once the last is. */
function write(device: GPUDevice, cube: HeldCube) {
  const { prepared, texture, numbers, halves } = cube
  const count = preparedMipCount(prepared)
  const started = cpuNow()
  do {
    const side = mipSize(prepared.size, cube.level)
    const rows = Math.min(side - cube.row, Math.max(1, Math.floor(CHUNK_TEXELS / side)))
    ambientCubemapMipRows(prepared, cube.level, cube.face, cube.row, rows, numbers)
    rgbToHalfRgba(halves, numbers, 0, side * rows, cube.cube)
    device.queue.writeTexture(
      { texture, mipLevel: cube.level, origin: [0, cube.row, cube.face] },
      halves,
      { bytesPerRow: side * 8, rowsPerImage: rows },
      { width: side, height: rows },
    )
    cube.row += rows
    if (cube.row === side) {
      cube.row = 0
      if (++cube.face === 6) {
        cube.face = 0
        cube.level++
      }
    }
  } while (cube.level < count && msSince(started) < MS_PER_IMAGE)
  return cube.level === count
}

function drop(frame: AmbientCubemapFrame, device: GPUDevice) {
  if (frame.held) retire(device, frame.held.texture)
  frame.held = undefined
}

/**
 * What a program that reads the ambient cubemap binds this image: the cube, whole with its mips, and its colour; none while the image
 * has no light from it, the chain is not whole yet (its next rows are written) or the view is not lit (`lit`: the cube is kept, not written).
 */
export function ambientCubemapResources(rt: Rt, lit: boolean) {
  const frame = follow(rt)
  const { device } = rt.gpu
  const cube = frame.cube
  if (!device || !frame.on || !cube) {
    if (device) drop(frame, device)
    frame.pending = false
    return undefined
  }
  // A view that is not lit keeps the cube it made, and does not write more of it.
  if (!lit) {
    frame.pending = false
    return undefined
  }
  if (frame.held?.data.texels !== cube.texels || frame.held.data.size !== cube.size) {
    drop(frame, device)
    frame.held = open(device, cube)
  }
  const held = frame.held!
  const whole = held.level === preparedMipCount(held.prepared) || write(device, held)
  frame.pending = !whole
  const colour = (frame.colour ??= device.createBuffer({
    label: 'Trillion3D ambient cubemap colour',
    size: 16,
    usage: UNIFORM | BUFFER_COPY_DST,
  }))
  const { written, rgb } = frame
  let moved = false
  for (let i = 0; i < 3; i++) {
    const light = rgb[i] * held.light
    if (light !== written[i]) {
      written[i] = light
      moved = true
    }
  }
  if (moved) device.queue.writeBuffer(colour, 0, written)
  return whole ? { view: held.view, colour } : undefined
}

/** Hands the cube and the colour to the retire list: the session's end. */
export function releaseAmbientCubemap(rt: Rt) {
  const frame = rt.lights.ambientCubemap
  const { device } = rt.gpu
  if (!frame || !device) return
  drop(frame, device)
  if (frame.colour) retire(device, frame.colour)
  rt.lights.ambientCubemap = undefined
}
