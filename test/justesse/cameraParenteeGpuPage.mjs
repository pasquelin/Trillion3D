// Côté page de la reproduction GPU : la vraie sélection WebGPU du moteur (`createGpuDagSelection`,
// ses tampons, son noyau et sa relecture), alimentée par les vrais `cameraSelectionUniforms`.
// Empaqueté par esbuild puis exécuté dans Chromium : rien n'est rejoué hors du GPU.
import { cameraSelectionUniforms } from '../../packages/sdk-browser/gpuSelection.ts';
import {
  createGpuDagSelection,
  packDagSelection,
} from '../../packages/sdk-browser/gpuDagSelection.ts';
import { collectClusterPages } from '../../packages/sdk-browser/pageSelection.ts';
import { dagFixture } from '../../packages/sdk-browser/pageSelectionDagFixture.ts';
import { POSES_PARENT, cameraAplatie, creeRig, poseRig } from './cameraRig.mjs';
import { ouvrirAppareil } from './appareilWebgpu.mjs';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';

const VIEWPORT = [1280, 720];

/** Une sélection GPU neuve par séquence : aucun relevé d'une séquence ne sert l'autre. */
async function sequence(device, cameras, pixelError) {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const packed = packDagSelection(roots);
  const selection = await createGpuDagSelection(device, packed);
  if (!selection) throw new Error('GPU_SELECTION_UNAVAILABLE');
  const images = [];
  for (const camera of cameras()) {
    selection.dispatch(cameraSelectionUniforms(cameraMoteur(camera), pixelError, VIEWPORT));
    const result = await selection.flush();
    if (!result) throw new Error('GPU_SELECTION_FAILED');
    images.push({
      pages: result.pageIds.map((id) => packed.pageUrls[id]).sort(),
      frustumRejected: result.frustumRejected,
    });
  }
  selection.dispose();
  return images;
}

export async function executer(pixelErrors) {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const cas = [];
  for (const pixelError of pixelErrors) {
    const rig = creeRig();
    const avecParent = await sequence(
      device,
      function* () {
        for (const pose of POSES_PARENT) yield poseRig(rig, pose, false);
      },
      pixelError,
    );
    const sansParent = await sequence(
      device,
      function* () {
        for (const pose of POSES_PARENT) yield cameraAplatie(pose);
      },
      pixelError,
    );
    cas.push({ pixelError, avecParent, sansParent });
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, cas, erreurs };
}
