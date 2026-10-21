// The same scene rendered by the hardware raster alone (`softwareRaster: false`), then under the
// cluster split — the clusters whose edges project small to the software raster, the others and
// the one that crosses the near plane to the hardware —, and the images compared pixel by pixel.
// Each tile is two triangles that share a diagonal, in two distinct clusters: the shared edge par
// excellence, under every slope. What may differ is the silhouette band of the hardware image alone
// — a pixel whose neighbourhood holds both coverage and background, where two rasterizers' sample
// positions can differ by one pixel. The band is read on an image the software raster never
// touched: a stray triangle on the background or a crack inside a tile falls outside it, and
// counts.
import type { EngineContext } from '../../../packages/sdk-browser/src/session/engine/types.ts'
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/diagnostic/types.ts'
import { runOnDevice } from '../../kit/device/deviceProof.ts'
import { VIEWPORT, cameraFace, release, engine } from '../../kit/device/sharedSceneProof.ts'
import { image } from '../../kit/device/sceneImageProof.ts'
import { tileScene } from './computeRasterScene.ts'

const [WIDTH, HEIGHT] = VIEWPORT
const isBackground = (pixels: Uint8Array, i: number) =>
  pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0

/** The silhouette band: a pixel whose 3×3 neighbourhood holds both background and coverage. */
function silhouetteBand(pixels: Uint8Array) {
  const band = new Uint8Array(WIDTH * HEIGHT)
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      let background = false,
        covered = false
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [xx, yy] = [x + dx, y + dy]
          if (xx < 0 || yy < 0 || xx >= WIDTH || yy >= HEIGHT) continue
          if (isBackground(pixels, (yy * WIDTH + xx) * 4)) background = true
          else covered = true
        }
      band[y * WIDTH + x] = background && covered ? 1 : 0
    }
  return band
}

/** The pixels that differ: counted on the band, listed as `[x, y]` off it. */
function compare(hardware: Uint8Array, compute: Uint8Array, band: Uint8Array) {
  let silhouette = 0
  const interior: number[][] = []
  for (let p = 0; p < band.length; p++) {
    const i = p * 4
    if ([0, 1, 2].every((c) => hardware[i + c] === compute[i + c])) continue
    if (band[p]) silhouette++
    else interior.push([p % WIDTH, Math.floor(p / WIDTH)])
  }
  return { silhouette, interior }
}

/** The scene's second image on a fresh engine of `options`: the first places the occluder
 *  history, the second plays both halves. */
async function render(
  device: GPUDevice,
  onDiagnostic: (e: EngineDiagnostic) => void,
  options: Partial<EngineContext>,
) {
  const scene = tileScene()
  const { backend, canvas } = engine(scene, device, onDiagnostic, {
    maxResidentPages: 32,
    ...options,
  })
  try {
    await backend.prepare()
    await image(backend, cameraFace(0))
    const { pixels, metrics } = await image(backend, cameraFace(0))
    return { pixels: pixels.slice(), clusters: metrics.clusters ?? null }
  } finally {
    release(backend, canvas, scene)
  }
}

/** The cluster split at its default threshold, and at 64 px: the longest edge whose triangles still
 *  fit the 64-pixel box the software setup holds, which hands it every tile of the scene but the
 *  huge one and the one across the near plane. */
const SPLITS: Record<string, Partial<EngineContext>> = {
  'split at 32 px': {},
  'split at 64 px': { hardwareRasterEdgePixels: 64 },
}

interface RasterReading {
  covered: number
  clusters: number | null
  variants: Record<string, ReturnType<typeof compare> & { clusters: number | null }>
}

export function compareRasters() {
  return runOnDevice<RasterReading>(async (device, events, reading) => {
    const onDiagnostic = (e: EngineDiagnostic) => void events.push(e)
    const hardware = await render(device, onDiagnostic, { softwareRaster: false })
    const band = silhouetteBand(hardware.pixels)
    reading.variants = {}
    for (const [split, options] of Object.entries(SPLITS)) {
      const both = await render(device, onDiagnostic, options)
      reading.variants[split] = {
        clusters: both.clusters,
        ...compare(hardware.pixels, both.pixels, band),
      }
    }
    let covered = 0
    for (let i = 0; i < hardware.pixels.length; i += 4)
      if (!isBackground(hardware.pixels, i)) covered++
    Object.assign(reading, { covered, clusters: hardware.clusters })
  })
}
