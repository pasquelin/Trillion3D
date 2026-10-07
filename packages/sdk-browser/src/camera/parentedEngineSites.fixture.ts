// The "whole engine" sites of the parented-camera test: a frame rendered by a public engine, from
// which what the camera decided is recorded. WebGPU runs on the tests' fake device: every buffer
// write is recorded (view, blend, light and shadow uniforms included), with no GPU.
import { createHash } from 'node:crypto'
import { mock } from 'node:test'
import { webgpuPagesEngine } from '../webgpu/pages/pages.ts'
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts'
import { camera as mainCamera, quadScene } from '../webgpu/pages/testScenes.fixture.ts'
import { DAG, dagLevel } from '../engine/pagesEngine.fixture.ts'
import { fanScene, quadCluster } from '../engine/pagesEngineScenes.fixture.ts'
import type { HostCamera } from './world.ts'
import type { EngineContext, Engine } from '../engine/types.ts'
import type { ClusterManifest } from '../../../sdk-core/src/index.ts'

/** The fan's manifest without its primitives: same shape as `QUAD_MANIFEST`
 *  (`packages/sdk-browser/src/engine/pagesEngineScenes.fixture.ts`), the fields the mock backend never reads left at neutral values. */
const FAN_MANIFEST: Omit<ClusterManifest, 'primitives'> = {
  ...DAG,
  schema: 1,
  status: 'ready',
  key: 'fan',
  scope: 'slice',
  sourceTriangles: 2,
  selectedTriangles: 2,
  selectedNodes: 0,
  totalNodes: 0,
}

/** One engine site, called with the state `create()` built and the frame's camera; returns what
 *  `measure` read from that frame, ready to be JSON-stringified for comparison. */
export interface Site {
  name: string
  create?: () => unknown
  measure: (state: unknown, camera: HostCamera) => unknown
}

const COUNTS = ['clusters', 'selectedTriangles', 'frustumRejected', 'lodLevel', 'residentPages']
const counts = (metrics: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(COUNTS.map((key) => [key, metrics[key] ?? null]))

/** The transparent fan reduced by a coarse level: cut, LOD and blend pass exercise there. */
function transparentFan(): EngineContext & { dispose: () => void } {
  const { geometry, material, mesh, source, indices } = fanScene()
  const primitive = dagLevel([quadCluster(0, 0), quadCluster(1, 3)], [quadCluster(3, 0)], 0.02, [
    quadCluster(2, 6),
  ])
  return {
    source,
    metadata: {
      ...FAN_MANIFEST,
      primitives: [{ mesh: 0, primitive: 0, pass: 'clustered-blend', ...primitive }],
    },
    indices,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    viewport: [32, 32],
    dispose: () => (geometry.dispose(), material.dispose()),
  }
}

/** WebGPU backend state: the fake device (records every write), the prepared backend, and the
 *  release of the engine's clock. */
type EngineState = { gpu: ReturnType<typeof mockGpu>; backend: Engine; dispose: () => void }

/** The engine's clock: still within a frame, one display frame further at each. The camera's
 *  motion — the velocity the GPU cut's view ahead reads (`./motion.ts`) — is then a function of the
 *  poses alone, never of how long a run took: the two runs compared write the same uniforms. */
const clock = { ms: 0 }

async function webgpuEngine(scene: EngineContext): Promise<EngineState> {
  installGpuGlobals()
  clock.ms = 0
  const held = mock.method(performance, 'now', () => clock.ms)
  const gpu = mockGpu()
  const backend = webgpuPagesEngine({
    ...scene,
    gpuDevice: gpu.device,
    maxResidentPages: 8,
    viewport: [32, 32],
  })
  await backend.prepare()
  return { gpu, backend, dispose: () => held.mock.restore() }
}

/** One frame per pose, recorded as the host requests it; residency follows after. */
async function webgpuImage({ gpu, backend }: EngineState, camera: HostCamera) {
  gpu.writes.length = 0
  clock.ms += 1000 / 60
  backend.render(camera)
  const metrics = counts(backend.metrics())
  const byLabel = new Map<string, ReturnType<typeof createHash>>()
  for (const write of gpu.writes) {
    const label = write.label ?? '?'
    if (!byLabel.has(label)) byLabel.set(label, createHash('sha256'))
    byLabel.get(label)?.update(write.bytes)
  }
  const writes: Record<string, string> = {}
  for (const [label, hash] of [...byLabel].sort(([a], [b]) => (a < b ? -1 : 1)))
    writes[label] = hash.digest('hex').slice(0, 16)
  await backend.flush()
  return { writes, ...metrics }
}

export const engineSites: Site[] = [
  {
    name: 'webgpuPagesEngine opaque (encode, lights, shadows, Hi-Z)',
    create: () => webgpuEngine(quadScene()),
    measure: (state, camera) => webgpuImage(state as EngineState, camera),
  },
  {
    name: 'webgpuPagesEngine transparent (blend uniforms)',
    create: () => webgpuEngine(transparentFan()),
    measure: (state, camera) => webgpuImage(state as EngineState, camera),
  },
  {
    name: 'webgpuPagesEngine.captureSurfaceView (second view)',
    // The main view is fixed and parentless: only the second view comes from the rig.
    create: async () => {
      const engine = await webgpuEngine(quadScene())
      await webgpuImage(engine, mainCamera())
      return engine
    },
    measure: async (state, camera) => {
      const { backend } = state as EngineState
      if (!backend.captureSurfaceView) throw new Error('backend has no captureSurfaceView')
      const surface = await backend.captureSurfaceView(camera, { width: 16, height: 16 })
      const reading = {
        cameraWorld: surface.cameraWorld,
        inverseViewProjection: surface.inverseViewProjection,
        selectedTriangles: surface.selectedTriangles,
      }
      surface.dispose()
      await backend.flush()
      return reading
    },
  },
]
