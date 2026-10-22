import type { AsideCut } from '../../gpu/core/aside.ts'
import type { GpuSelection } from '../../gpu/core/selection.ts'
import { createGpuRaster } from '../../visibility/raster/raster.ts'
import { HIZ_LEVELS } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { budgetRefused, ledgerTentative } from '../../gpu/core/deviceLedger.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import { createWebgpuView, type WebgpuView } from '../backend/state/view.ts'
import { onView } from '../backend/state/viewSwitch.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** What the primed pyramid holds between its building and the cut that tests against it. */
export type PrimeBuilt = {
  /** The image it was built for (`WebgpuRunState.frame`). */
  frame: number
  /** The pyramid's texture view and the copy of the levels uniform it was built with. */
  view: GPUTextureView
  levels: GPUBuffer
  /** The size it was drawn at, which a box is tested in (`SelectionUniforms.prevSize`). */
  size: [number, number]
}

/**
 * THE PRIMED PYRAMID'S OWN: a view that holds nothing but what a small depth-only draw needs — a
 * depth target and a visibility target, the raster over them, the Hi-Z's pyramid —, at the main
 * view's targets shifted right by `shift`; its cut on the shared tables (`GpuSelection.aside`,
 * primed), the copy of the levels its pyramid was built with, and what it built this image. Made
 * only while a view primes (`hizPrime`), given back when none does.
 */
export type Prime = {
  view: WebgpuView
  /** The sizes and the raster capacity it was made for: another key makes it again. */
  key: string
  textures: GPUTexture[]
  levels: GPUBuffer
  cut: AsideCut | undefined
  /** The selection the cut is on: another one (the running cut was replaced) makes it anew. */
  selection: GpuSelection | undefined
  /** The render matrix the draw and the test share, this image's. */
  matrix: Float64Array
  built: PrimeBuilt | undefined
}

const primes = new WeakMap<WebgpuPagesRuntime, Prime>()
/** The key the device ledger refused to hold the primed pyramid at: not asked again until it changes. */
const refused = new WeakMap<WebgpuPagesRuntime, string>()

/** The runtime's primed pyramid, none while it holds none. */
export const primeOf = (rt: WebgpuPagesRuntime) => primes.get(rt)

/** The size of a primed draw of an image of `width × height`, its targets shifted right by `shift`
 *  and never under a pixel. */
export const primedExtent = (value: number, shift: number) => Math.max(1, value >> shift)

/**
 * The runtime's primed pyramid made, or kept when its key stands: its targets at the main view's
 * `allocatedSize` shifted right by `shift`, its raster over them for the table's capacity. A
 * pyramid the Hi-Z cannot make gives back what was made, and none.
 */
export function ensurePrime(rt: WebgpuPagesRuntime, device: GPUDevice, shift: number) {
  const [allocatedWidth, allocatedHeight] = rt.gpu.allocatedSize,
    capacity = rt.layout.rasterCapacity
  const width = primedExtent(allocatedWidth, shift),
    height = primedExtent(allocatedHeight, shift)
  const key = `${width}x${height}:${capacity}`
  const held = primes.get(rt)
  if (held?.key === key) return held
  releasePrime(rt)
  if (refused.get(rt) === key || !rt.vis.gpuHiz || capacity < 1 || allocatedWidth < 1)
    return undefined
  // An optional resource, counted by the device ledger like the main targets: past the budget it is
  // refused without refusing the session, and the image is cut without a primed pyramid.
  try {
    const prime = ledgerTentative(device, () =>
      buildPrime(rt, device, width, height, capacity, key),
    )
    if (prime) primes.set(rt, prime)
    return prime
  } catch (error) {
    if (!budgetRefused(error)) throw error
    refused.set(rt, key)
    return undefined
  }
}

/** The primed view made and its pyramid sized; nothing held when either is refused. */
function buildPrime(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
  capacity: number,
  key: string,
) {
  const prime = makePrime(device, width, height, capacity, key)
  try {
    if (onView(rt, prime.view, () => !!rt.vis.gpuHiz?.resize(device, width, height))) return prime
  } catch (error) {
    disposePrime(prime)
    throw error
  }
  disposePrime(prime)
  return undefined
}

function makePrime(
  device: GPUDevice,
  width: number,
  height: number,
  capacity: number,
  key: string,
): Prime {
  const view = createWebgpuView(width, height)
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  const depth = device.createTexture({
    label: 'Trillion3D primed depth',
    size: { width, height },
    format: DEPTH_FORMAT,
    usage,
  })
  const ids = device.createTexture({
    label: 'Trillion3D primed visibility',
    size: { width, height },
    format: 'r32uint',
    usage,
  })
  view.gpu.depthTexture = depth
  view.gpu.depthView = depth.createView()
  view.gpu.allocatedSize = [width, height]
  view.gpu.targetSize = [width, height]
  // Drawn as the image it stands for, no render scale between them (`renderPixelRatio`).
  view.gpu.displaySize = [width, height]
  view.vis.visTexture = ids
  view.vis.visView = ids.createView()
  let levels: GPUBuffer | undefined
  try {
    levels = device.createBuffer({
      label: 'Trillion3D primed pyramid levels',
      size: HIZ_LEVELS.words * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    view.vis.gpuRaster = createGpuRaster(device, width, height, capacity)
  } catch (error) {
    // A refusal of the budget leaves nothing of the pyramid counted.
    levels?.destroy()
    depth.destroy()
    ids.destroy()
    throw error
  }
  return {
    view,
    key,
    textures: [depth, ids],
    levels,
    cut: undefined,
    selection: undefined,
    matrix: new Float64Array(16),
    built: undefined,
  }
}

/** Gives back what the runtime's primed pyramid holds. */
export function releasePrime(rt: WebgpuPagesRuntime) {
  const prime = primes.get(rt)
  if (!prime) return
  primes.delete(rt)
  disposePrime(prime)
}

function disposePrime({ view, textures, levels, cut }: Prime) {
  cut?.dispose()
  view.vis.gpuRaster?.dispose()
  view.hiz?.destroy()
  view.hiz = undefined
  for (const texture of textures) texture.destroy()
  levels.destroy()
}
