// "Whole engine" sites: a frame rendered by a public engine, from which we record what the camera
// decided. WebGPU runs on the tests' fake device: every buffer write is recorded (view, blend,
// light and shadow uniforms included), with no GPU.
import { createHash } from 'node:crypto';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/webgpuPages.ts';
import { exactPagesBackend } from '../../../packages/sdk-browser/exactPagesBackend.ts';
import { threeLodBackend } from '../../../packages/sdk-browser/threeLod.ts';
import { installGpuGlobals } from '../../kit/gpu/globals.ts';
import { mockGpu } from '../../kit/gpu/mockGpu.ts';
import {
  camera as principale,
  quadScene,
} from '../../../packages/sdk-browser/webgpuPagesTestScenes.ts';
import { DAG, dagLevel } from '../../../packages/sdk-browser/pagesBackendFixture.ts';
import {
  fanScene,
  quadCluster,
  quadRootsContext,
} from '../../../packages/sdk-browser/pagesBackendScenes.ts';
import type { HostCamera } from '../../../packages/sdk-browser/cameraWorld.ts';
import type { BackendContext, RenderBackend } from '../../../packages/sdk-browser/backendTypes.ts';
import type { ClusterManifest } from '../../../packages/sdk-core/index.ts';

/** The fan's manifest without its primitives: same shape as `QUAD_MANIFEST`
 *  (`pagesBackendScenes.ts`), the fields the mock backend never reads left at neutral values. */
const FAN_MANIFEST: Omit<ClusterManifest, 'primitives'> = {
  ...DAG,
  schema: 1,
  status: 'ready',
  key: 'fan',
  scope: 'slice',
  sourceTriangles: 2,
  selectedTriangles: 2,
  selectedNodes: [],
  totalNodes: 0,
};

/** One engine site, called with the state `cree()` built and the frame's camera; returns what
 *  `mesure` read from that frame, ready to be JSON-stringified for comparison. `nom` is read by
 *  `camera-parentee.ts` but no site sets it — kept optional so that dead read stays typed, not
 *  silently renamed to `name`. */
export interface Site {
  name: string;
  nom?: string;
  cree?: () => unknown;
  mesure: (state: unknown, camera: HostCamera) => unknown;
}

const COMPTES = ['clusters', 'selectedTriangles', 'frustumRejected', 'lodLevel', 'residentPages'];
const comptes = (metrics: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(COMPTES.map((cle) => [cle, metrics[cle] ?? null]));

/** The transparent fan reduced by a coarse level: cut, LOD and blend pass exercise there. */
function fanTransparent(): BackendContext & { dispose: () => void } {
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
async function imageWebgpu({ gpu, backend }: EngineState, camera: HostCamera) {
  gpu.writes.length = 0;
  backend.render(camera);
  const metrics = comptes(backend.metrics());
  const parEtiquette = new Map<string, ReturnType<typeof createHash>>();
  for (const write of gpu.writes) {
    const cle = write.label ?? '?';
    if (!parEtiquette.has(cle)) parEtiquette.set(cle, createHash('sha256'));
    parEtiquette.get(cle)?.update(write.bytes);
  }
  const ecritures: Record<string, string> = {};
  for (const [cle, hash] of [...parEtiquette].sort(([a], [b]) => (a < b ? -1 : 1)))
    ecritures[cle] = hash.digest('hex').slice(0, 16);
  await backend.flush?.();
  return { ecritures, ...metrics };
}

export const sitesMoteurs: Site[] = [
  {
    name: 'webgpuPagesBackend opaque (encode, lights, shadows, Hi-Z)',
    cree: () => webgpuEngine(quadScene()),
    mesure: (state, camera) => imageWebgpu(state as EngineState, camera),
  },
  {
    name: 'webgpuPagesBackend transparent (blend uniforms)',
    cree: () => webgpuEngine(fanTransparent()),
    mesure: (state, camera) => imageWebgpu(state as EngineState, camera),
  },
  {
    name: 'webgpuPagesBackend.captureSurfaceView (seconde vue)',
    // The main view is fixed and parentless: only the second view comes from the rig.
    cree: async () => {
      const engine = await webgpuEngine(quadScene());
      await imageWebgpu(engine, principale());
      return engine;
    },
    mesure: async (state, camera) => {
      const { backend } = state as EngineState;
      if (!backend.captureSurfaceView) throw new Error('backend has no captureSurfaceView');
      const surface = await backend.captureSurfaceView(camera, { width: 16, height: 16 });
      const releve = {
        cameraWorld: surface.cameraWorld,
        inverseViewProjection: surface.inverseViewProjection,
        selectedTriangles: surface.selectedTriangles,
      };
      surface.dispose();
      await backend.flush?.();
      return releve;
    },
  },
  {
    name: 'exactPagesBackend (cut, streaming priority)',
    cree: () => exactPagesBackend(quadRootsContext(false, { viewport: [320, 180] }).context),
    mesure: (state, camera) => {
      const backend = state as RenderBackend;
      backend.render(camera);
      return { ...comptes(backend.metrics()), pending: backend.pendingUrls?.() ?? null };
    },
  },
  {
    name: 'threeLodBackend (THREE.LOD)',
    cree: () => threeLodBackend(fanTransparent()),
    mesure: (state, camera) => {
      const backend = state as RenderBackend;
      backend.render(camera);
      return comptes(backend.metrics());
    },
  },
];
