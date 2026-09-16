import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const browser = new URL('../packages/sdk-browser/', import.meta.url);

// LE CHEMIN PAR IMAGE NE DÉPEND PLUS DE LA BIBLIOTHÈQUE HÔTE.
//
// Ces fichiers décident une image : la coupe, le test d'occlusion, la projection, l'encodage. Ils ne
// lisent la caméra que par la structure que le moteur possède (`EngineCamera`, `cameraWorld.ts`), et
// les matrices que par leurs seize flottants. Aucun `Matrix4`, `Vector3`, `Camera`, `Box3`, `Sphere`,
// `Frustum` ni `Quaternion` de l'hôte n'y entre, ni par un import, ni par une signature.
//
// Ce qui reste hors de cette liste porte des RESSOURCES de l'hôte — matériaux, textures, géométries,
// maillages, lampes, couleurs, constantes de face et d'enroulement — ou écrit son graphe de scène
// (`webgpuPagesTransform.ts`, `webglFrameGate.ts`). `cameraWorld.ts` est la frontière : c'est le seul
// fichier du chemin par image qui a le droit de nommer un type de l'hôte, et il le fait une fois par
// image, pour le recopier.
//
// Y ajouter un fichier est une décision, pas un oubli : un fichier qui sort de cette liste dit que le
// calcul par image a repris une dépendance que ce lot a retirée.
const SANS_HOTE = [
  // La coupe de clusters, de son entrée à ses replis.
  'pageSelectionCut.ts',
  'pageSelectionCutBounds.ts',
  'pageSelectionCutLogic.ts',
  'pageSelectionCutNode.ts',
  'pageSelectionCutRepair.ts',
  'pageSelectionCutSelect.ts',
  'pageSelectionCutVisit.ts',
  'pageSelectionDiagnostic.ts',
  'pageSelectionMath.ts',
  'pageSelectionProjection.ts',
  'pageSelectionRequests.ts',
  'streamingPriority.ts',
  // Le test d'occlusion et sa projection.
  'hizCorners.ts',
  'hizCounts.ts',
  'hizDepth.ts',
  'hizOcclusion.ts',
  'hizProjection.ts',
  'hizProjectionHold.ts',
  'hizSplit.ts',
  'hizTemporal.ts',
  'hizTypes.ts',
  'hizUnoccluded.ts',
  // Le tampon de visibilité du côté calcul.
  'visibilityFrame.ts',
  'visibilityProjection.ts',
  'visibilityShade.ts',
  'visibilityShadePixel.ts',
  // L'empreinte de vue et les seize flottants d'une matrice.
  'frameViewRevision.ts',
  'matrixElements.ts',
  'viewFingerprint.ts',
  // L'image WebGPU : entrée, coupes, encodage, traces.
  'webgpuBlendDiagnostic.ts',
  'webgpuBlendSelection.ts',
  'webgpuBlendUniforms.ts',
  'webgpuPagesEncodeBlend.ts',
  'webgpuPagesEncodeDraws.ts',
  'webgpuPagesEncodeLights.ts',
  'webgpuPagesEncodeShadows.ts',
  'webgpuPagesEncodeVis.ts',
  'webgpuPagesEncodeVisSetup.ts',
  'webgpuPagesGpuCut.ts',
  'webgpuPagesGpuCutTrace.ts',
  'webgpuPagesHostApi.ts',
  'webgpuPagesRender.ts',
  'webgpuPagesRenderCpu.ts',
  'webgpuPagesRenderTrace.ts',
  'webgpuPagesSurfaceRestore.ts',
  'webgpuPagesWinding.ts',
  'webgpuVisibilityPartition.ts',
];

const IMPORTE_HOTE = /from\s+['"]three['"]/;

test('le chemin par image n’importe pas la bibliothèque hôte', async () => {
  const fuites = [];
  for (const file of SANS_HOTE) {
    const text = await readFile(new URL(file, browser), 'utf8');
    if (IMPORTE_HOTE.test(text)) fuites.push(file);
  }
  assert.deepEqual(fuites, [], `frontière déclarée dans ${import.meta.url}`);
});

test('`cameraWorld.ts` est la seule frontière de caméra du chemin par image', async () => {
  const text = await readFile(new URL('cameraWorld.ts', browser), 'utf8');
  // Le contrat nomme le type de l'hôte une fois, et rend une structure que le moteur possède.
  assert.match(text, /export type HostCamera = THREE\.PerspectiveCamera/);
  assert.match(text, /export function readCameraWorld\(/);
  for (const champ of ['world', 'projection', 'view', 'viewProjection', 'planes', 'eye'])
    assert.match(text, new RegExp(`\\b${champ}\\b`), champ);
});
