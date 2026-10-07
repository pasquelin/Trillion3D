// Three's WebGPU renderer, as every Three witness draws with it: the bare and level-of-detail pages
// (`threeMeasurePage.ts`), the deformation reference (`deformationWitness.ts`) and the material
// proof (`tests/gpu/webgpu/materialPixelsRender.ts`). Initialised before its first frame, sRGB
// output at exposure 1, its image read back from the GPU and its GPU time read from its timestamp
// queries. Served to the page under `/runner/`, it imports only `three` — never the engine.
import * as THREE from 'three/webgpu'

export interface WitnessRendererOptions {
  width: number
  height: number
  /** Timestamp queries around each pass, read by `gpuFrameTimes`, when the adapter offers them. */
  timestamps?: boolean
  /** Where a lost device is written down as it happens, beside the library's own report. */
  lost?: string[]
}

/** A witness renderer on `canvas`, its device acquired: ready to compile and draw. */
export async function createWitnessRenderer(
  canvas: HTMLCanvasElement,
  { width, height, timestamps = false, lost }: WitnessRendererOptions,
) {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    trackTimestamp: timestamps,
  })
  const report = renderer.onDeviceLost.bind(renderer)
  renderer.onDeviceLost = (info) => {
    lost?.push(`gpu-device-lost: ${info.message}`)
    report(info)
  }
  await renderer.init()
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMappingExposure = 1
  return renderer
}

/** What the library keeps of a texture on its device: not in its type declarations. */
type BackendInternals = { device: GPUDevice; get(object: object): { texture: GPUTexture } }

/**
 * The image of `scene` through `camera` as the canvas shows it — tone mapping and output colour
 * space applied by the library's output pass — read from the GPU in bottom-to-top rows, as the
 * engine's capture returns them. A presented canvas texture cannot be copied, so the frame is
 * drawn once more into a target set as the renderer's output. The copy is written here and not
 * with `readRenderTargetPixelsAsync`, whose buffer ignores the 256-byte row alignment it asks for.
 */
export async function readWitnessImage(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<Uint8Array> {
  const { x: width, y: height } = renderer.getDrawingBufferSize(new THREE.Vector2())
  const target = new THREE.RenderTarget(width, height)
  renderer.setOutputRenderTarget(target)
  try {
    renderer.render(scene, camera)
  } finally {
    renderer.setOutputRenderTarget(null)
    renderer.setRenderTarget(null)
  }
  const backend = renderer.backend as unknown as BackendInternals
  const { device } = backend
  const row = width * 4,
    stride = Math.ceil(row / 256) * 256
  const buffer = device.createBuffer({
    size: stride * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer(
    { texture: backend.get(target.texture).texture },
    { buffer, bytesPerRow: stride },
    { width, height },
  )
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(GPUMapMode.READ)
  const rows = new Uint8Array(buffer.getMappedRange())
  const pixels = new Uint8Array(row * height)
  // The texture's first row is the top of the image; the capture's is the bottom.
  for (let y = 0; y < height; y++)
    pixels.set(rows.subarray(y * stride, y * stride + row), (height - 1 - y) * row)
  buffer.unmap()
  buffer.destroy()
  target.dispose()
  return pixels
}

/**
 * The GPU time of each frame, from the library's timestamp queries — the sum of the passes it
 * drew; the library gives no split per pass. `sample()` after each frame starts a resolve when
 * none is in flight, so the frame loop never waits on the GPU; a resolve covers every frame since
 * the one before it and is read as their mean. `drain()` waits for the resolve in flight and
 * empties the queries, so that warm-up frames count for nothing. For a renderer created with
 * `timestamps`: on an adapter without timestamp queries, nothing is read and nothing is published.
 */
export function gpuFrameTimes(renderer: THREE.WebGPURenderer) {
  const enabled = Boolean(renderer.hasFeature('timestamp-query'))
  const gpuFrameMs: number[] = []
  let frames = 0,
    pending: Promise<void> | null = null
  const resolve = (covered: number) =>
    renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER).then((ms) => {
      if (covered > 0 && typeof ms === 'number') gpuFrameMs.push(ms / covered)
    })
  return {
    gpuFrameMs,
    sample() {
      if (!enabled) return
      frames++
      if (pending) return
      pending = resolve(frames).finally(() => (pending = null))
      frames = 0
    },
    async drain() {
      if (!enabled) return
      await pending
      await resolve(0)
      frames = 0
    },
  }
}
