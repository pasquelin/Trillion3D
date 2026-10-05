// The "whole engine" sites of the parented-camera test: a frame rendered by a public engine, from
// which what the camera decided is recorded. WebGPU runs on the tests' fake device: every buffer
// write is recorded (view, blend, light and shadow uniforms included), with no GPU.
import { createHash } from 'node:crypto';
import { webgpuPagesBackend } from '../webgpu/pages/pages.ts';
import { exactPagesBackend } from '../../../../bench/witnesses/exact/backend.ts';
import { threeLodBackend } from '../../../../bench/witnesses/three/lod.ts';
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts';
import { camera as mainCamera, quadScene } from '../webgpu/pages/testScenes.fixture.ts';
import { DAG, dagLevel } from '../backend/pagesBackend.fixture.ts';
import { fanScene, quadCluster, quadRootsContext } from '../backend/pagesBackendScenes.fixture.ts';
import type { HostCamera } from './world.ts';
import type { BackendContext, RenderBackend } from '../backend/types.ts';
import type { ClusterManifest } from '../../../sdk-core/src/index.ts';

/** The fan's manifest without its primitives: same shape as `QUAD_MANIFEST`
 *  (`packages/sdk-browser/src/backend/pagesBackendScenes.fixture.ts`), the fields the mock backend never reads left at neutral values. */
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
};

/** One engine site, called with the state `create()` built and the frame's camera; returns what
 *  `measure` read from that frame, ready to be JSON-stringified for comparison. */
export interface Site {
  name: string;
  create?: () => unknown;
  measure: (state: unknown, camera: HostCamera) => unknown;
}

const COUNTS = ['clusters', 'selectedTriangles', 'frustumRejected', 'lodLevel', 'residentPages'];
const counts = (metrics: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(COUNTS.map((key) => [key, metrics[key] ?? null]));

/** The transparent fan reduced by a coarse level: cut, LOD and blend pass exercise there. */
function transparentFan(): BackendContext & { dispose: () => void } {
  const { geometry, material, mesh, source, indices } = fanScene();
  const primitive = dagLevel([quadCluster(0, 0), quadCluster(1, 3)], [quadCluster(3, 0)], 0.02, [
    quadCluster(2, 6),
  ]);
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
  };
}

/** WebGPU backend state: the fake device (records every write) and the prepared backend. */
type EngineState = { gpu: ReturnType<typeof mockGpu>; backend: RenderBackend };

async function webgpuEngine(scene: BackendContext): Promise<EngineState> {
  installGpuGlobals();
  const gpu = mockGpu();
  const backend = webgpuPagesBackend({
    ...scene,
    gpuDevice: gpu.device,
    maxResidentPages: 8,
    viewport: [32, 32],
  });
  await backend.prepare();
  return { gpu, backend };
}

/** One frame per pose, recorded as the host requests it; residency follows after. */
async function webgpuImage({ gpu, backend }: EngineState, camera: HostCamera) {
  gpu.writes.length = 0;
  backend.render(camera);
  const metrics = counts(backend.metrics());
  const byLabel = new Map<string, ReturnType<typeof createHash>>();
  for (const write of gpu.writes) {
    const label = write.label ?? '?';
    if (!byLabel.has(label)) byLabel.set(label, createHash('sha256'));
    byLabel.get(label)?.update(write.bytes);
  }
  const writes: Record<string, string> = {};
  for (const [label, hash] of [...byLabel].sort(([a], [b]) => (a < b ? -1 : 1)))
    writes[label] = hash.digest('hex').slice(0, 16);
  await backend.flush?.();
  return { writes, ...metrics };
}

export const engineSites: Site[] = [
  {
    name: 'webgpuPagesBackend opaque (encode, lights, shadows, Hi-Z)',
    create: () => webgpuEngine(quadScene()),
    measure: (state, camera) => webgpuImage(state as EngineState, camera),
  },
  {
    name: 'webgpuPagesBackend transparent (blend uniforms)',
    create: () => webgpuEngine(transparentFan()),
    measure: (state, camera) => webgpuImage(state as EngineState, camera),
  },
  {
    name: 'webgpuPagesBackend.captureSurfaceView (second view)',
    // The main view is fixed and parentless: only the second view comes from the rig.
    create: async () => {
      const engine = await webgpuEngine(quadScene());
      await webgpuImage(engine, mainCamera());
      return engine;
    },
    measure: async (state, camera) => {
      const { backend } = state as EngineState;
      if (!backend.captureSurfaceView) throw new Error('backend has no captureSurfaceView');
      const surface = await backend.captureSurfaceView(camera, { width: 16, height: 16 });
      const reading = {
        cameraWorld: surface.cameraWorld,
        inverseViewProjection: surface.inverseViewProjection,
        selectedTriangles: surface.selectedTriangles,
      };
      surface.dispose();
      await backend.flush?.();
      return reading;
    },
  },
  {
    name: 'exactPagesBackend (cut, streaming priority)',
    create: () => exactPagesBackend(quadRootsContext(false, { viewport: [320, 180] }).context),
    measure: (state, camera) => {
      const backend = state as RenderBackend;
      backend.render(camera);
      return { ...counts(backend.metrics()), pending: backend.pendingUrls?.() ?? null };
    },
  },
  {
    name: 'threeLodBackend (host-library LOD)',
    create: () => threeLodBackend(transparentFan()),
    measure: (state, camera) => {
      const backend = state as RenderBackend;
      backend.render(camera);
      return counts(backend.metrics());
    },
  },
];
