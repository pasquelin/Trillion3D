// Page of the lost-device proof: the real WebGPU engine on the repository DAG fixture, presenting
// into a canvas of its own — the composed path, where a host copies that canvas. The image is read
// back through WebGPU (the engine's flush-settled capture) while the device lives, then the device
// is destroyed, and what a host could still reach is read: the canvas the engine published must
// be withdrawn and its context unconfigured — the drawing buffer then holds transparent black —,
// the next render must raise `WEBGPU_LOST`, and the loss must have been announced under that name.
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts'
import {
  dagFixture,
  wideCamera,
} from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts'
import type { BackendDiagnostic } from '../../../packages/sdk-browser/src/backend/types.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

/** Colour channels that are not black, alpha aside. */
const litChannels = (pixels: Uint8Array) =>
  pixels.reduce((n, v, i) => (i % 4 !== 3 && v !== 0 ? n + 1 : n), 0)

/** The canvas context's configuration, `null` once unconfigured. */
const configurationOf = (canvas: HTMLCanvasElement) =>
  canvas.getContext('webgpu')?.getConfiguration() ?? null

export async function run() {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device, errors } = gpu
  const events: Pick<BackendDiagnostic, 'phase' | 'message' | 'context'>[] = []
  const fixture = dagFixture()
  const backend = webgpuPagesBackend({
    source: fixture.source,
    metadata: fixture.metadata,
    indices: fixture.indices,
    associations: fixture.associations,
    gpuDevice: device,
    maxResidentPages: 8,
    viewport: [128, 128],
    pixelError: 0,
    clearColor: 0x000000,
    diagnosticDetail: 'summary',
    onDiagnostic: (e) => events.push({ phase: e.phase, message: e.message, context: e.context }),
  })
  const camera = wideCamera()
  try {
    await backend.prepare()
    for (let i = 0; i < 4; i++) {
      backend.render(camera)
      await backend.flush!()
    }
    const surface = backend.presentedSurface
    if (!surface) throw new Error('no composed surface published')
    const before = {
      litChannels: litChannels(backend.capture!()),
      configured: configurationOf(surface) !== null,
    }
    device.destroy()
    await device.lost
    // The engine's own reaction to the promise runs before this one; one more turn for safety.
    await Promise.resolve()
    let renderError: string | null = null
    try {
      backend.render(camera)
    } catch (error) {
      renderError = String(error)
    }
    return {
      before,
      after: {
        published: backend.presentedSurface !== undefined,
        configured: configurationOf(surface) !== null,
        frameHeld: backend.metrics().frameHeld ?? null,
        renderError,
        loss: events.find((e) => e.phase === 'gpu-device-lost') ?? null,
      },
      events,
      errors,
    }
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
  }
}
