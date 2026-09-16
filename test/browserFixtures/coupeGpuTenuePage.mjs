// Côté page de la preuve : le vrai moteur WebGPU sur un vrai DAG de clusters, avec un budget de
// résidence trop petit pour ses feuilles. Le noyau veut donc des pages absentes, et la coupe monte
// vers l'ancêtre résident — le chemin même où la sélection GPU était jetée.
//
// Rien n'est inspecté de l'intérieur : seuls les compteurs publics `cpuSelectMs` (nul tant que la
// coupe GPU choisit) et `gpuSelectionFallback` (faux tant qu'elle n'a pas été abandonnée) décident.
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { dagFixture, wideCamera } from '../../packages/sdk-browser/pageSelectionDagFixture.ts';
import { ouvrirAppareil } from '../../packages/sdk-browser/bench/justesse/appareilWebgpu.mjs';

const IMAGES = 30;

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const evenements = [];
  const fixture = dagFixture();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const backend = webgpuPagesBackend({
    source: fixture.source,
    metadata: fixture.metadata,
    indices: fixture.indices,
    associations: fixture.associations,
    gpuDevice: device,
    gpuCanvas: canvas,
    // Trop peu pour les quatre feuilles ET pour les deux nœuds qui les remplacent : la coupe monte
    // vers l'ancêtre résident à chaque image, et retombe au besoin sur la couverture racine.
    maxResidentPages: 2,
    viewport: [128, 128],
    pixelError: 0,
    clearColor: 0x000000,
    diagnosticDetail: 'summary',
    onDiagnostic: (e) => evenements.push({ phase: e.phase, message: e.message }),
  });
  const camera = wideCamera(),
    images = [];
  try {
    await backend.prepare();
    // Chargement : les pages que la coupe demande arrivent, puis la mesure commence.
    for (let i = 0; i < 4; i++) {
      backend.render(camera);
      await backend.flush();
    }
    for (let i = 0; i < IMAGES; i++) {
      backend.render(camera);
      backend.cpuFrameEnd?.();
      await backend.flush();
      const m = backend.metrics();
      images.push({
        i,
        cpuSelectMs: m.cpuSelectMs ?? null,
        gpuSelectionFallback: m.gpuSelectionFallback ?? null,
        uncoveredTriangles: m.uncoveredTriangles ?? null,
        clusters: m.clusters ?? null,
        residentPages: m.residentPages ?? null,
      });
    }
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), images, evenements, erreurs };
  } finally {
    backend.dispose();
    canvas.remove();
    fixture.geometry.dispose();
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, images, evenements, erreurs };
}
