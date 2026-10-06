// The GPU cut's per-image CPU steps as wholes, on the engine's own runtime: a WebGPU pages
// backend mounted on the mock device that executes the selection kernel on the CPU
// (`tests/kit/gpu/mockGpu.ts`), drawing a streamed two-level terrain while the camera flies over
// it. Each image's bounds are read from the engine's own CPU profile (`webgpu/pages/render/cpuStepTable.ts`),
// the ones the explorer publishes: `adoptCutMs` (`services.adoptGpuCut`, `webgpu/cut/publication.ts`),
// `admissionMs` (`admitGpuCut`) and the residency stream (`streamCutResidency`: queue, rows and
// flags upload). One image's state cannot be replayed, so each frame is one sample.
import { stats } from '../../core/chrono.ts'
import { rapport } from '../../core/index.ts'
import type { Measurement } from '../../core/index.ts'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { collectClusterPages } from '../../../packages/sdk-browser/src/page/selection/selection.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { createWebgpuPagesRuntime } from '../../../packages/sdk-browser/src/webgpu/pages/runtime.ts'
import { prepareWebgpuBackend } from '../../../packages/sdk-browser/src/webgpu/pages/prepare/prepare.ts'
import { renderWebgpuPages } from '../../../packages/sdk-browser/src/webgpu/pages/render/render.ts'
import { flushWebgpuPages } from '../../../packages/sdk-browser/src/webgpu/pages/render/flush.ts'
import { disposeWebgpuPages } from '../../../packages/sdk-browser/src/webgpu/pages/io/metrics.ts'
import { CPU_STEP } from '../../../packages/sdk-browser/src/webgpu/pages/render/cpuStepTable.ts'
import { mockGpu } from '../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../tests/kit/gpu/globals.ts'
import { cutFrameScene } from './support/cutFrameScene.ts'

const SIDE = 96,
  WARM = 40,
  FRAMES = 240
installGpuGlobals()
const scene = cutFrameScene(SIDE)
const { roots } = collectClusterPages(
  scene.source,
  scene.metadata,
  scene.indices,
  scene.associations,
)
const dag = packDagSelection(roots)
const gpu = mockGpu({
  packed: dag,
  limits: { maxBufferSize: 1 << 28, maxStorageBufferBindingSize: 1 << 27 },
})
const rt = createWebgpuPagesRuntime({
  ...scene,
  indices: new Map(),
  readPage: async (url: string) => scene.indices.get(url)!,
  gpuDevice: gpu.device,
  maxResidentPages: 2048,
  viewport: [1280, 720],
})
await prepareWebgpuBackend(rt, gpu.device)

const camera = G.perspectiveCamera(60, 16 / 9, 0.1, 2000)
/** Frame `f` of a flight low over the terrain, turning slowly: the cut refines ahead, coarsens behind. */
function pose(f: number, still: boolean) {
  const t = still ? 0 : f
  camera.position.set(20 + t * 0.6, 10, 20 + t * 0.45)
  camera.lookAt(60 + t * 0.6 + 20 * Math.sin(t / 60), 0, 90 + t * 0.45)
  camera.updateMatrixWorld()
}

const STEPS = {
  adoption: [CPU_STEP.adoptCutMs],
  admission: [CPU_STEP.admissionMs],
  stream: [CPU_STEP.residencyQueueMs, CPU_STEP.syncRowsMs, CPU_STEP.residencyUploadMs],
} as const
type Step = keyof typeof STEPS

/** `frames` images; each one's three bounds, and whether the adopted cut is the readback it read
 *  and the admission's verdict the one its counts give. */
async function flight(frames: number, still: boolean) {
  const durations: Record<Step, number[]> = { adoption: [], admission: [], stream: [] }
  let fault: string | null = null,
    read = 0
  for (let f = 0; f < frames; f++) {
    pose(f, still)
    const sample = rt.run.gpuSelection?.peek()
    renderWebgpuPages(rt, camera)
    if (sample) read++
    if (sample && !fault) {
      const adopted = rt.run.desired.map((r) => r.url).sort()
      const readback = sample.result.pageIds.map((id) => dag.pageUrlOf(id)).sort()
      if (adopted.join() !== readback.join())
        fault = `frame ${f}: the adopted cut is not the readback`
      const { requestedCount, keepCount } = rt.services.residencySets,
        slots = rt.setup.slots
      if (rt.run.coverageBudgetLimited !== (requestedCount > slots || keepCount > slots))
        fault = `frame ${f}: the admission verdict is not its counts'`
    }
    const row = rt.timing.cpuProfile.row
    for (const step of Object.keys(STEPS) as Step[])
      durations[step].push(STEPS[step].reduce((sum, at) => sum + row[at], 0))
    await flushWebgpuPages(rt)
  }
  // Every image but the first has a readback to adopt: a check that read none proved nothing.
  if (read < frames - 1) fault ??= `only ${read} of ${frames} images had a readback to check`
  return { durations, fault }
}

await flight(WARM, false)
const flights = {
  'flying, 9 216 leaves under 576 roots': await flight(FRAMES, false),
  'still camera': await flight(60, true),
}
disposeWebgpuPages(rt)

const FILES: Record<Step, string> = {
  adoption: 'packages/sdk-browser/src/webgpu/cut/publication.ts',
  admission: 'packages/sdk-browser/src/webgpu/pages/render/gpuCutAdmission.ts',
  stream: 'packages/sdk-browser/src/webgpu/pages/render/gpuCutStream.ts',
}
const measurements: Measurement[] = (Object.keys(STEPS) as Step[]).map((step) => ({
  name: `GPU cut ${step}, per image`,
  fichier: FILES[step],
  resultats: Object.entries(flights).map(([name, { durations, fault }]) => {
    const s = stats(durations[step].filter(Number.isFinite))
    return {
      name,
      size: null,
      ...s,
      nsParElement: null,
      opsParSec: s.medianeMs > 0 ? Math.round(1000 / s.medianeMs) : null,
      temoin: null,
      ecartTemoin: null,
      correct: fault === null,
      difference: fault,
      motif: 'one image per sample, read from the engine CPU profile',
    }
  }),
}))

rapport(
  'coupe-gpu-etapes',
  measurements,
  'each image adopts its readback and admits by its own counts',
)
