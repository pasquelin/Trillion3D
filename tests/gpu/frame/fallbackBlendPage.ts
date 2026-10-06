// Page of the fallback-blend proof: the real WebGPU engine on a real device, twice on one
// scene — once as the device is, once while that device refuses every render pipeline writing the
// visibility target, as a device without it does. The engine then draws with its fallback pass
// (`packages/sdk-browser/src/webgpu/frame/fallbackDraw.ts`); nothing else differs. Four paged
// transparent tiles, one per blending mode, sit across a night half and a paper half; the page
// reads each tile over each half, and the background beside it, on both images.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts'
import { hostBlending } from '../../../packages/sdk-browser/src/scene/materialBlending.ts'
import type { Blending } from '../../../packages/sdk-core/src/world/constants/index.ts'
import { batisseur, cameraFace, square, engine, release } from '../kit/sharedSceneProof.ts'
import { colorAt, image } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

export const MODES: readonly Blending[] = ['normal', 'additive', 'subtractive', 'multiply']
/** Where each tile's row sits, top to bottom, and the half-size of a tile. */
const ROWS = [0.9, 0.3, -0.3, -0.9],
  HALF = 0.25
/** Night on the left, paper on the right, read a quarter tile from the seam. */
const SIDES = { night: -0.12, paper: 0.12 } as const
const VIEW: [number, number] = [256, 256]
const IMAGES = 4

function scene() {
  const builder = batisseur()
  for (const [x, color] of [
    [-1.2, 0x0b1020],
    [1.2, 0xf4efe6],
  ] as const) {
    const background = G.mesh(square(1.2), G.basicSurface({ color, side: G.DOUBLE_SIDE }))
    background.position.set(x, 0, -1)
    builder.source.add(background)
    builder.add(background, 'exact-clusters', 1.2)
  }
  MODES.forEach((mode, rank) => {
    const surface = G.basicSurface({
      color: 0xff8030,
      transparent: true,
      opacity: 0.8,
      side: G.DOUBLE_SIDE,
    })
    Object.assign(surface, { blending: hostBlending(mode) })
    const tile = G.mesh(square(HALF), surface)
    tile.position.y = ROWS[rank]
    builder.source.add(tile)
    builder.add(tile, 'clustered-blend', HALF)
  })
  return builder.fini()
}

/** True when a render pipeline writes the visibility target, the `r32uint` attachment. */
const writesVisibility = (descriptor: GPURenderPipelineDescriptor) =>
  [...(descriptor.fragment?.targets ?? [])].some((target) => target?.format === 'r32uint')

/**
 * Runs `work` while `device` refuses every render pipeline that writes the visibility target, by
 * either of its two factories, as a device without it does: the fallback's one trigger. The
 * refusal sits on the device itself — the engine claims the device through its own session
 * handle, which calls the device's factory at each creation, and its canvas is configured with
 * the device (`sharedGpuDevice`), which a wrapper of it is not. The device's own factories come
 * back afterwards.
 */
async function withoutVisibility<T>(device: GPUDevice, work: () => Promise<T>) {
  const make = device.createRenderPipeline.bind(device),
    makeAsync = device.createRenderPipelineAsync.bind(device)
  device.createRenderPipeline = (descriptor) => {
    if (writesVisibility(descriptor)) throw new Error('VISIBILITY_TARGET_REFUSED')
    return make(descriptor)
  }
  device.createRenderPipelineAsync = async (descriptor) => {
    if (writesVisibility(descriptor)) throw new Error('VISIBILITY_TARGET_REFUSED')
    return makeAsync(descriptor)
  }
  try {
    return await work()
  } finally {
    // The overrides are own properties: deleting them gives the prototype's methods back.
    delete (device as Partial<GPUDevice>).createRenderPipeline
    delete (device as Partial<GPUDevice>).createRenderPipelineAsync
  }
}

/** One side: its last image, each tile and the background over each half, and whether it fell
 *  back. */
async function side(device: GPUDevice, events: unknown[], name: string) {
  const s = scene(),
    camera = cameraFace()
  // No GPU canvas on either side: one refuses the fallback at prepare, by name.
  const { backend, canvas } = engine(
    webgpuPagesBackend,
    s,
    device,
    (e) => events.push({ side: name, ...e }),
    { gpuCanvas: undefined, viewport: [...VIEW] },
  )
  const over = (pixels: Uint8Array, y: number) =>
    Object.fromEntries(
      Object.entries(SIDES).map(([half, x]) => [half, colorAt(pixels, camera, x, y, 0, VIEW)]),
    )
  try {
    await backend.prepare()
    let pixels: Uint8Array = new Uint8Array(0)
    for (let i = 0; i < IMAGES; i++) pixels = (await image(backend, camera)).pixels
    const tiles = MODES.map((mode, rank) => ({ mode, ...over(pixels, ROWS[rank]) }))
    const fellBack = backend.capabilities.unsupported.includes('visibility buffer')
    return { fellBack, background: over(pixels, 0), tiles }
  } finally {
    release(backend, canvas, s)
  }
}

/** Both sides on one device: the image as it is, then the image once the visibility target is refused. */
export function run() {
  return runOnDevice<{ main: unknown; fallback: unknown }>(async (device, events, result) => {
    result.main = await side(device, events, 'main')
    result.fallback = await withoutVisibility(device, () => side(device, events, 'fallback'))
  })
}
