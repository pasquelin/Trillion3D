// Three's WebGPU renderer, as every Three witness draws with it: the bare and level-of-detail pages
// (`threeMeasurePage.ts`), the deformation reference (`deformationWitness.ts`) and the material
// proof (`tests/gpu/webgpu/materialPixelsRender.ts`). Initialised before its first frame, sRGB
// output at exposure 1 and its image read back from the GPU. Served to the page under `/runner/`, it imports only `three` — never the engine.
import * as THREE from 'three/webgpu'
import { readTexture } from '../../../tests/gpu/kit/computeReadback.ts'

export interface WitnessRendererOptions {
  width: number
  height: number
  /** Where a lost device is written down as it happens, beside the library's own report. */
  lost?: string[]
}

/** A witness renderer on `canvas`, its device acquired: ready to compile and draw. */
export async function createWitnessRenderer(
  canvas: HTMLCanvasElement,
  { width, height, lost }: WitnessRendererOptions,
) {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
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
  const rows = await readTexture(device, backend.get(target.texture).texture, 4)
  const row = width * 4,
    pixels = new Uint8Array(row * height)
  // The texture's first row is the top of the image; the capture's is the bottom.
  for (let y = 0; y < height; y++)
    pixels.set(rows.subarray(y * row, (y + 1) * row), (height - 1 - y) * row)
  target.dispose()
  return pixels
}
