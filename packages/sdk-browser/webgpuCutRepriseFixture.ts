// Le dispositif du banc de reprise de coupe GPU, séparé de ses cas pour qu'aucun des deux fichiers
// ne dépasse la limite de lignes. Les cas vivent dans `webgpuCutReprise.test.ts`.
import * as THREE from 'three';
import { renderGpuCut } from './webgpuPagesGpuCut.ts';
import { mountCutAdopter } from './webgpuCutAdopterFixture.ts';
import { cameraSelectionUniforms, createSelectionUniforms } from './gpuSelection.ts';
import { cameraMoteur } from './cameraFixture.ts';
import type { GpuCut, GpuSelection } from './gpuSelection.ts';
import type { PageRec } from './pageSelection.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const VIEWPORT: [number, number] = [512, 512];

/**
 * Un banc minimal autour de `renderGpuCut` : une page, une sélection GPU simulée et des services de
 * résidence simulés. La page n'a pas encore ses octets ; `arrive()` les lui donne, comme le ferait
 * le décodage d'un transfert processeur.
 */
export function banc(panne?: 'debordement' | 'envoi') {
  const hote = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  hote.position.z = 5;
  hote.updateMatrixWorld(true);
  // Le noyau ne lit plus la caméra de l'hôte : l'entrée d'image la recopie une fois au contrat.
  const camera = cameraMoteur(hote);
  const uniforms = createSelectionUniforms();
  cameraSelectionUniforms(camera, 0, VIEWPORT, uniforms);
  const page = {
    url: 'p0',
    triangles: 1,
    transparent: false,
    packedIndex: 0,
  } as unknown as PageRec & { array?: Uint32Array };
  const comptes = { queue: 0, sync: 0, residence: 0, envois: 0, attentes: 0, disposes: 0 };
  const codes: string[] = [];
  const residentFlags = new Uint32Array(1);
  // Ce que la sélection GPU croit de la résidence, et le relevé qu'elle en tire à chaque envoi.
  let vueResidence = 0;
  let releve: GpuCut = {
    uniforms,
    result: {
      pageIds: [0],
      drawablePageIds: [0],
      frustumRejected: 0,
      lodLevel: 0,
      complete: false,
    },
  };
  const selection = {
    updateResidency(flags: Uint32Array) {
      comptes.residence++;
      const change = vueResidence !== flags[0];
      vueResidence = flags[0]!;
      return change;
    },
    dispose() {
      comptes.disposes++;
    },
    dispatch() {
      comptes.envois++;
      if (panne === 'envoi') throw new Error('ENVOI_PERDU');
      // La sélection calcule la complétude : une page voulue et résidente fait un relevé complet.
      releve = {
        uniforms,
        result: {
          pageIds: [0],
          drawablePageIds: [0],
          frustumRejected: 0,
          lodLevel: 0,
          complete: vueResidence === 1,
        },
      };
      return undefined;
    },
    peek: () => releve,
  } as unknown as GpuSelection;
  const { adopter, counts, desired, shown } = mountCutAdopter({
    packedPages: [page],
    residentOffsetWords: new Int32Array([0]),
    uniforms,
    selection: () => selection,
  });
  const rows = {
    // Déjà posée : `ensurePageTable` n'a pas d'appareil à solliciter sur ce banc.
    pageTableFloats: new Float32Array(4),
    candidateOverflow: panne === 'debordement' ? 1 : 0,
    candidateCount: 1,
    residentFlags,
    residencyChanges: undefined,
    clearResidencyChanges: () => {},
  };
  const rt = {
    run: {
      gpuSelection: selection,
      selectionUniforms: uniforms,
      budgetPixelError: 0,
      coverageBudgetLimited: false,
      gpuMetricsReady: false,
      desired,
      gate: { resourcesChanged: () => {} },
      frame: 0,
      imageRevision: 1,
    },
    gpu: { cache: {}, cutIncomplete: false, selectionFallback: false },
    capabilities: { gpuDriven: true, unsupported: [] },
    diag: {
      traceDiagnostic: () => {
        comptes.attentes++;
      },
      engineDiagnostic: (code: string) => codes.push(code),
      diagnosticFailure: (code: string) => codes.push(code),
    },
    context: {},
    layout: { rows, drawSlots: 4 },
    setup: { gpuDevice: {}, viewport: VIEWPORT, clearColor: 0, slots: 10 },
    timing: { marks: {} },
    services: {
      bootstrapState: { ready: true },
      residencySets: {
        get requestedCount() {
          return desired.length;
        },
      },
      queueCutResidency: () => {
        comptes.queue++;
      },
      syncRows: () => {
        comptes.sync++;
        // La résidence suit les octets : une page décodée devient résidente pour la sélection.
        residentFlags[0] = page.array ? 1 : 0;
      },
      adoptGpuCut: () => {
        adopter.adopt();
        rt.gpu.cutIncomplete = adopter.metrics.incomplete;
      },
    },
  } as unknown as WebgpuPagesRuntime & { gpu: { cutIncomplete: boolean } };
  return {
    camera,
    comptes,
    codes,
    shown,
    desired,
    rt,
    image: () => renderGpuCut(rt, camera, 0, 0, 0),
    arrive: () => {
      page.array = new Uint32Array([0, 1, 2]);
      // Les octets arrivent : ce que le journal des rangs ferait, le banc le fait à la main.
      counts.touch(0);
    },
  };
}
