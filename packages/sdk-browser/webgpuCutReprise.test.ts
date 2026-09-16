// Une coupe GPU incomplète doit pouvoir se reprendre toute seule. L'image en attente ne dessine
// rien, mais elle réclame les pages manquantes, publie la résidence et envoie la sélection : sans
// cet envoi, le même relevé incomplet reviendrait à chaque image et la coupe resterait bloquée
// dessus, caméra immobile, même une fois les octets arrivés.
//
// Le relevé complet de la reprise n'est pas fourni par le test : il est produit par la sélection
// simulée, à partir des drapeaux de résidence que l'image en attente lui a publiés.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { renderGpuCut } from './webgpuPagesGpuCut.ts';
import { createWebgpuCutAdopter } from './webgpuCutAdoption.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import type { GpuCut, GpuSelection, SelectionUniforms } from './gpuSelection.ts';
import type { PageRec } from './pageSelection.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const VIEWPORT: [number, number] = [512, 512];

/**
 * Un banc minimal autour de `renderGpuCut` : une page, une sélection GPU simulée et des services de
 * résidence simulés. La page n'a pas encore ses octets ; `arrive()` les lui donne, comme le ferait
 * le décodage d'un transfert processeur.
 */
function banc() {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld(true);
  const uniforms: SelectionUniforms = {
    planes: new Float32Array(24),
    view: new Float32Array(16),
    pixelScale: [1, 1],
    pixelError: 0,
    near: 0.1,
    cameraWorld: [0, 0, 0],
  };
  cameraSelectionUniforms(camera, 0, VIEWPORT, uniforms);
  const page = {
    url: 'p0',
    triangles: 1,
    transparent: false,
    packedIndex: 0,
  } as unknown as PageRec & { array?: Uint32Array };
  const comptes = { queue: 0, sync: 0, residence: 0, envois: 0, attentes: 0 };
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
    dispatch() {
      comptes.envois++;
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
  const desired: PageRec[] = [],
    shown: PageRec[] = [],
    drawn: PageRec[] = [];
  const adopter = createWebgpuCutAdopter({
    selection: () => selection,
    packedPages: [page],
    desired,
    shown,
    drawn,
    uniforms,
    residentOffsetWords: new Int32Array([0]),
    delta: createCutDelta([page], desired),
    drawnDelta: createCutDelta([page], []),
    onCutDelta: () => {},
    onDrawnDelta: () => {},
    onDrawnMirrored: () => {},
  });
  const rows = {
    // Déjà posée : `ensurePageTable` n'a pas d'appareil à solliciter sur ce banc.
    pageTableFloats: new Float32Array(4),
    candidateOverflow: 0,
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
    gpu: { cache: {}, cutIncomplete: false },
    diag: {
      traceDiagnostic: () => {
        comptes.attentes++;
      },
      engineDiagnostic: () => {},
      diagnosticFailure: () => {},
    },
    context: {},
    layout: { rows, drawSlots: 4 },
    setup: { gpuDevice: {}, viewport: VIEWPORT, clearColor: 0, slots: 10 },
    timing: { marks: {} },
    services: {
      bootstrapState: { ready: true },
      admitCut: () => desired.length,
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
    shown,
    desired,
    rt,
    image: () => renderGpuCut(rt, camera, 0, 0, 0),
    arrive: () => (page.array = new Uint32Array([0, 1, 2])),
  };
}

test('une image en attente réclame, synchronise et envoie : la reprise a de quoi se produire', () => {
  const b = banc();
  for (let i = 0; i < 3; i++) assert.equal(b.image(), true, `image ${i}`);
  assert.equal(b.comptes.attentes, 3, 'les trois images ont attendu une couverture complète');
  assert.equal(b.rt.gpu.cutIncomplete, true, 'et la coupe est restée incomplète, page absente');
  // Aucune image d'attente ne se contente de relire : chacune a fait avancer le flux.
  assert.equal(b.comptes.queue, 3, 'les pages voulues sont réclamées à chaque attente');
  assert.equal(b.comptes.sync, 3, 'la résidence est synchronisée à chaque attente');
  assert.equal(b.comptes.envois, 3, 'la sélection est envoyée à chaque attente');
  // La liste voulue est publiée : c'est elle qui fait venir la page manquante.
  assert.deepEqual(
    b.desired.map((p) => p.url),
    ['p0'],
  );
  assert.deepEqual(b.shown, [], 'rien n’est dessiné depuis une couverture incomplète');
});

test('la page arrivée, la coupe redevient complète sans que la caméra bouge', () => {
  const b = banc();
  b.image();
  assert.equal(b.rt.gpu.cutIncomplete, true);
  // Les octets arrivent. La caméra n'a pas bougé et le budget n'a pas changé.
  b.arrive();
  const envoisAvant = b.comptes.envois;
  assert.equal(b.image(), true, 'l’image reste en attente : le relevé complet n’est pas encore là');
  assert.ok(b.comptes.envois > envoisAvant, 'mais elle a publié la résidence et envoyé');
  // L'image suivante commence par adopter : elle trouve le relevé complet que l'attente a fait
  // produire. Le test n'en a fourni aucun.
  b.rt.services.adoptGpuCut();
  assert.equal(b.rt.gpu.cutIncomplete, false, 'la couverture est complète');
  assert.deepEqual(
    b.shown.map((p) => p.url),
    ['p0'],
    'et la page est dessinée',
  );
});
