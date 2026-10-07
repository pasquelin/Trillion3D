// Page of the anisotropy cost measure (#360, #361, `bench/runner/counts/anisotropyCost.ts`): one textured
// floor seen at a grazing angle, drawn by the WebGPU engine at each anisotropy asked, the GPU time
// of each image read from the engine's own timer. The camera slides by a hair at every image, so
// no image is held and each one pays its reads. Loaded on Dawn: its engine modules read the WebGPU
// globals.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { batisseur, engine, release } from '../kit/sharedSceneProof.ts'
import { median } from '../../../scripts/median.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

/** Half side of the floor, in scene units: the far edge reaches the horizon of the view. */
const HALF = 200
/** Side of the floor's picture in texels, and how many times it repeats across the floor. */
const PICTURE = 1024,
  REPEAT = 64
/** Images drawn before the timed ones. */
const WARMUP = 30

interface Reading {
  anisotropy: number
  /** p50 of the image envelope, submit to done (`gpuFrameMs`). */
  frameMs: number | null
  /** p50 of the sum of the timed passes, when the device has timestamp queries. */
  passesMs: number | null
  samples: number
}

const p50 = (values: number[]) => (values.length ? median(values) : null)

/** A picture with detail at every texel — a seeded noise, so the reads cannot share a cache line
 *  — repeated, mipmapped and filtered trilinearly at `anisotropy`. */
function floorMap(anisotropy: number) {
  const texels = new Uint8Array(PICTURE * PICTURE * 4)
  let seed = 1
  for (let i = 0; i < texels.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    texels[i] = (i & 3) === 3 ? 255 : seed >>> 24
  }
  const map = Object.assign(G.dataTexture(texels, PICTURE, PICTURE), {
    colorSpace: G.HOST_COLOUR_SPACE_SRGB,
    magFilter: G.HOST_FILTER_LINEAR,
    minFilter: G.HOST_FILTER_LINEAR_MIP_LINEAR,
    generateMipmaps: true,
    wrapS: G.HOST_WRAP_REPEAT,
    wrapT: G.HOST_WRAP_REPEAT,
    anisotropy,
  })
  map.repeat.set(REPEAT, REPEAT)
  return map
}

/** Frames of one anisotropy: warm-up images first, then the timed ones. */
async function measure(
  device: GPUDevice,
  anisotropy: number,
  size: [number, number],
  frames: number,
): Promise<Reading> {
  const builder = batisseur()
  const floor = G.mesh(
    G.planeGeometry(2 * HALF, 2 * HALF),
    G.basicSurface({ map: floorMap(anisotropy) }),
  )
  floor.rotation.x = -Math.PI / 2
  builder.source.add(floor)
  builder.add(floor, 'exact-clusters', HALF)
  const scene = builder.fini()
  const { backend, canvas } = engine(scene, device, () => {}, {
    viewport: size,
    stageProfile: true,
  })
  const camera = G.perspectiveCamera(55, size[0] / size[1], 0.1, 4 * HALF)
  const frameMs: number[] = [],
    passesMs: number[] = []
  let lastSample = -1
  try {
    await backend.prepare()
    for (let image = 0; image < WARMUP + frames; image++) {
      camera.position.set((image & 1) * 1e-3, 1, HALF * 0.9)
      camera.lookAt(0, 0.7, 0)
      camera.updateMatrixWorld(true)
      backend.render(camera)
      backend.cpuFrameEnd()
      await backend.flush()
      const metrics = backend.metrics() as {
        gpuFrameMs?: number | null
        gpuPassMs?: { frame: number; totalMs: number | null } | null
      }
      const sample = metrics.gpuPassMs
      if (image < WARMUP || !sample || sample.frame === lastSample) continue
      lastSample = sample.frame
      if (typeof metrics.gpuFrameMs === 'number') frameMs.push(metrics.gpuFrameMs)
      if (typeof sample.totalMs === 'number') passesMs.push(sample.totalMs)
    }
  } finally {
    release(backend, canvas, scene)
  }
  return { anisotropy, frameMs: p50(frameMs), passesMs: p50(passesMs), samples: frameMs.length }
}

/** Runs the floor at each anisotropy, one engine at a time, on a device that times its passes
 *  when it can. */
export async function run({
  anisotropies,
  size,
  frames,
}: {
  anisotropies: number[]
  size: [number, number]
  frames: number
}) {
  // The engine's own device: its limits and features, its uncaptured errors heard.
  const gpu = await openGpuDevice(['timestamp-query'])
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device, errors } = gpu
  const timed = device.features.has('timestamp-query')
  const readings: Reading[] = []
  let adapterName: string
  try {
    for (const anisotropy of anisotropies)
      readings.push(await measure(device, anisotropy, size, frames))
  } finally {
    adapterName = (await gpu.fermer()).court
  }
  // A frame that failed validation drew nothing: its time is no reading.
  if (errors.length) throw new Error(`uncaptured GPU errors: ${errors.join('; ')}`)
  return { readings, timed, gpu: adapterName.trim() }
}
