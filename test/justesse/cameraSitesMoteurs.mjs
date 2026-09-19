// "Whole engine" sites: a frame rendered by a public engine, from which we record what the camera
// decided. WebGPU runs on the tests' fake device: every buffer write is recorded (view, blend,
// light and shadow uniforms included), with no GPU.
import { createHash } from 'node:crypto';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { exactPagesBackend } from '../../packages/sdk-browser/exactPagesBackend.ts';
import { threeLodBackend } from '../../packages/sdk-browser/threeLod.ts';
import { installGpuGlobals } from '../../packages/sdk-browser/webgpuPagesTestGlobals.ts';
import { mockGpu } from '../../packages/sdk-browser/webgpuPagesMockGpu.ts';
import {
  camera as principale,
  quadScene,
} from '../../packages/sdk-browser/webgpuPagesTestScenes.ts';
import { DAG, dagLevel } from '../../packages/sdk-browser/pagesBackendFixture.ts';
import {
  fanScene,
  quadCluster,
  quadRootsContext,
} from '../../packages/sdk-browser/pagesBackendScenes.ts';

const COMPTES = ['clusters', 'selectedTriangles', 'frustumRejected', 'lodLevel', 'residentPages'];
const comptes = (metrics) => Object.fromEntries(COMPTES.map((cle) => [cle, metrics[cle] ?? null]));

/** The transparent fan reduced by a coarse level: cut, LOD and blend pass exercise there. */
function fanTransparent() {
  const { geometry, material, mesh, source, indices } = fanScene();
  const primitive = dagLevel([quadCluster(0, 0), quadCluster(1, 3)], [quadCluster(3, 0)], 0.02, [
    quadCluster(2, 6),
  ]);
  return {
    source,
    metadata: {
      ...DAG,
      primitives: [{ mesh: 0, primitive: 0, pass: 'clustered-blend', ...primitive }],
    },
    indices,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    viewport: [32, 32],
    dispose: () => (geometry.dispose(), material.dispose()),
  };
}

async function webgpuEngine(scene) {
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
async function imageWebgpu({ gpu, backend }, camera) {
  gpu.writes.length = 0;
  backend.render(camera);
  const metrics = comptes(backend.metrics());
  const parEtiquette = new Map();
  for (const write of gpu.writes) {
    const cle = write.label ?? '?';
    if (!parEtiquette.has(cle)) parEtiquette.set(cle, createHash('sha256'));
    parEtiquette.get(cle).update(write.bytes);
  }
  const ecritures = {};
  for (const [cle, hash] of [...parEtiquette].sort(([a], [b]) => (a < b ? -1 : 1)))
    ecritures[cle] = hash.digest('hex').slice(0, 16);
  await backend.flush?.();
  return { ecritures, ...metrics };
}

export const sitesMoteurs = [
  {
    name: 'webgpuPagesBackend opaque (encode, lights, shadows, Hi-Z)',
    cree: () => webgpuEngine(quadScene()),
    mesure: imageWebgpu,
  },
  {
    name: 'webgpuPagesBackend transparent (blend uniforms)',
    cree: () => webgpuEngine(fanTransparent()),
    mesure: imageWebgpu,
  },
  {
    name: 'webgpuPagesBackend.captureSurfaceView (seconde vue)',
    // La vue principale est fixe et sans parent : seule la seconde vue vient du rig.
    cree: async () => {
      const engine = await webgpuEngine(quadScene());
      await imageWebgpu(engine, principale());
      return engine;
    },
    mesure: async (etat, camera) => {
      const surface = await etat.backend.captureSurfaceView(camera, { width: 16, height: 16 });
      const releve = {
        cameraWorld: surface.cameraWorld,
        inverseViewProjection: surface.inverseViewProjection,
        selectedTriangles: surface.selectedTriangles,
      };
      surface.dispose();
      await etat.backend.flush?.();
      return releve;
    },
  },
  {
    name: 'exactPagesBackend (cut, streaming priority)',
    cree: () => exactPagesBackend(quadRootsContext(false, { viewport: [320, 180] }).context),
    mesure: (backend, camera) => {
      backend.render(camera);
      return { ...comptes(backend.metrics()), pending: backend.pendingUrls?.() ?? null };
    },
  },
  {
    name: 'threeLodBackend (THREE.LOD)',
    cree: () => threeLodBackend(fanTransparent()),
    mesure: (backend, camera) => {
      backend.render(camera);
      return comptes(backend.metrics());
    },
  },
];
