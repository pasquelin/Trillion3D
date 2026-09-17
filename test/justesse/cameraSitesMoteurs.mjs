// Sites « moteur entier » : une image rendue par un moteur public, dont on relève ce que la caméra a
// décidé. WebGPU tourne sur le faux périphérique des tests : chaque écriture de tampon est relevée
// (uniformes de vue, de transparents, de lumière et d'ombre compris), sans aucune carte graphique.
import { createHash } from 'node:crypto';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { exactPagesBackend } from '../../packages/sdk-browser/exactPagesBackend.ts';
import { threeLodBackend } from '../../packages/sdk-browser/threeLod.ts';
import { installGpuGlobals } from '../../packages/sdk-browser/webgpuPagesTestGlobals.ts';
import { mockGpu } from '../../packages/sdk-browser/webgpuPagesMockGpu.ts';
import { camera as principale, quadScene } from '../../packages/sdk-browser/webgpuPagesTestScenes.ts';
import { DAG, dagLevel } from '../../packages/sdk-browser/pagesBackendFixture.ts';
import { fanScene, quadCluster, quadRootsContext } from '../../packages/sdk-browser/pagesBackendScenes.ts';

const COMPTES = ['clusters', 'selectedTriangles', 'frustumRejected', 'lodLevel', 'residentPages'];
const comptes = (metrics) => Object.fromEntries(COMPTES.map((cle) => [cle, metrics[cle] ?? null]));

/** Le fan transparent réduit par un niveau grossier : coupe, LOD et passe de mélange s'y exercent. */
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

async function moteurWebgpu(scene) {
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

/** Une image par pose, relevée telle que l'hôte la demande ; la résidence suit ensuite. */
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
    nom: 'webgpuPagesBackend opaque (encodage, lumières, ombres, Hi-Z)',
    cree: () => moteurWebgpu(quadScene()),
    mesure: imageWebgpu,
  },
  {
    nom: 'webgpuPagesBackend transparent (uniformes de mélange)',
    cree: () => moteurWebgpu(fanTransparent()),
    mesure: imageWebgpu,
  },
  {
    nom: 'webgpuPagesBackend.captureSurfaceView (seconde vue)',
    // La vue principale est fixe et sans parent : seule la seconde vue vient du rig.
    cree: async () => {
      const moteur = await moteurWebgpu(quadScene());
      await imageWebgpu(moteur, principale());
      return moteur;
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
    nom: 'exactPagesBackend (coupe, priorité de streaming)',
    cree: () => exactPagesBackend(quadRootsContext(false, { viewport: [320, 180] }).context),
    mesure: (backend, camera) => {
      backend.render(camera);
      return { ...comptes(backend.metrics()), pending: backend.pendingUrls?.() ?? null };
    },
  },
  {
    nom: 'threeLodBackend (THREE.LOD)',
    cree: () => threeLodBackend(fanTransparent()),
    mesure: (backend, camera) => {
      backend.render(camera);
      return comptes(backend.metrics());
    },
  },
];
