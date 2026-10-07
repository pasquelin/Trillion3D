// The real WebGPU engine on a real cluster DAG, with a residency budget too small for its leaves:
// the kernel wants missing pages, and the cut climbs to the resident ancestor — the very path where
// GPU selection used to be thrown away. Nothing is read from the inside: the drawn cut the engine
// publishes (`selectedPageIds`), whose coverage the proof checks leaf by leaf.
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/engine/types.ts'
import { webgpuPagesEngine } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts'
import {
  dagFixture,
  wideCamera,
} from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

const FRAMES = 30

/** The fixture strip runs along x from -2 to 2, one leaf per unit: the units each page spans. */
type PageSpan = { url: string; units: [number, number] }

export async function runHeldCut() {
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: 'no WebGPU adapter' }
  const { device } = gpu
  const events: Pick<EngineDiagnostic, 'phase' | 'message' | 'context'>[] = []
  const fixture = dagFixture()
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const backend = webgpuPagesEngine({
    source: fixture.source,
    metadata: fixture.metadata,
    indices: fixture.indices,
    associations: fixture.associations,
    gpuDevice: device,
    gpuCanvas: canvas,
    // Too few for the four leaves and the two nodes that replace them: the cut climbs to the
    // resident ancestor every frame, and falls back to root coverage if it must.
    maxResidentPages: 2,
    viewport: [128, 128],
    pixelError: 0,
    clearColor: 0x000000,
    diagnosticDetail: 'summary',
    onDiagnostic: (e) => events.push({ phase: e.phase, message: e.message, context: e.context }),
  })
  const camera = wideCamera()
  const frames = []
  try {
    await backend.prepare()
    // Loading: the pages the cut asks for arrive, then the measured frames begin.
    for (let i = 0; i < 4; i++) {
      backend.render(camera)
      await backend.flush()
    }
    for (let frame = 0; frame < FRAMES; frame++) {
      backend.render(camera)
      backend.cpuFrameEnd()
      await backend.flush()
      const m = backend.metrics()
      frames.push({
        frame,
        drawn: backend.selectedPageIds(),
        clusters: m.clusters ?? null,
        residentPages: m.residentPages ?? null,
      })
    }
  } catch (error) {
    const trace = error instanceof Error ? (error.stack ?? '') : ''
    return { error: String(error) + trace, frames, events, errors: gpu.errors }
  } finally {
    backend.dispose()
    canvas.remove()
    fixture.geometry.dispose()
  }
  const { court: adapter } = await gpu.fermer()
  const pages: PageSpan[] = fixture.metadata.primitives[0].pages.map((page) => ({
    url: page.url,
    units: [page.min[0] + 2, page.max[0] + 2],
  }))
  return { adapter, pages, frames, events, errors: gpu.errors }
}
