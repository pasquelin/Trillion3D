// Defect 2 (`setTransform` loses shear): what the engine sends the GPU to place a primitive is
// `root.world`, and the WGSL selection kernel brings frustum planes into that matrix's space.
// The test runs this kernel in Chromium WebGPU on the same page seen by the same camera, once
// with the requested (sheared) matrix and once with its translation-rotation-scale recomposition
// — what `setTransform` posed before this batch. The two verdicts differ: losing shear was not
// an approximation, it changed the selected page. `selectionGpu` comes from
// `tests/browser/probes/noyauSelectionGpu.ts`.
//
// node --experimental-strip-types tests/browser/renders/cisaillement-transform.browser.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OPEN_CONE } from '../../../packages/sdk-browser/pageCone.ts';
import {
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../../packages/sdk-browser/gpuDagSelection.ts';
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/gpuSelection.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/cameraFixture.ts';
import type { DagRoot } from '../../../packages/sdk-browser/gpuDagTypes.ts';
import { selectionGpu } from '../probes/noyauSelectionGpu.ts';

const VIEWPORT: [number, number] = [1000, 1000];
// Unit local box: sheared, it covers x ∈ [-4, 4]; recomposed as TRS, x ∈ [-2.364, 2.364].
const MIN = [-1, -1, -1],
  MAX = [1, 1, 1];

/** The requested matrix: `y` pushes `x`, two non-orthogonal axes. */
const cisaillee = () => new THREE.Matrix4().set(1, 3, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

/** What the defect posed: the same matrix reduced to a translation-rotation-scale product. */
function recomposee(source: THREE.Matrix4) {
  const position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    echelle = new THREE.Vector3();
  source.decompose(position, rotation, echelle);
  return new THREE.Matrix4().compose(position, rotation, echelle);
}

function empaquete(world: THREE.Matrix4, sphere: number[]) {
  return packDagSelection([
    {
      world,
      pages: [
        { url: '0', lodError: 0, parentError: null, sphere, min: MIN, max: MAX, cone: OPEN_CONE },
      ],
    },
  ]);
}

/** A narrow view on `x`: only the sheared box enters it. */
function vue(x: number, fov: number) {
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  camera.position.set(x, 0, 10);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld(true);
  return cameraSelectionUniforms(cameraMoteur(camera), 0, VIEWPORT);
}

const exacte = cisaillee(),
  approchee = recomposee(exacte);
assert.notDeepEqual(
  Array.from(approchee.elements),
  Array.from(exacte.elements),
  'the reproduction assumes two different matrices',
);

const sphereEtroite = [3.5, 0, 0, 1],
  sphereLarge = [0, 0, 0, 5];
/** One kernel call: the page packed IN THE RENDER FRAME of its view — the eye is its origin —
 *  as the frame input carries it to the GPU. Packing in absolute world under a relative view
 *  would mix two frames in the same formula, and the frustum would cut wrongly. */
const appel = (
  nom: string,
  world: THREE.Matrix4,
  sphere: number[],
  uniforms: ReturnType<typeof cameraSelectionUniforms>,
) => ({
  name: nom,
  packed: packedWorldsToRenderOrigin(
    empaquete(world, sphere),
    [{ world, pages: [] } satisfies DagRoot],
    uniforms.cameraWorld,
  ),
  uniforms,
});

const etroite = vue(3.5, 10),
  large = vue(0, 60);
const appels = [
  appel('etroite:exacte', exacte, sphereEtroite, etroite),
  appel('etroite:recomposee', approchee, sphereEtroite, etroite),
  appel('large:exacte', exacte, sphereLarge, large),
  appel('large:recomposee', approchee, sphereLarge, large),
];

const gpu = await selectionGpu(appels);
const pages = (nom: string) =>
  gpu.resultats?.find((r: { name: string }) => r.name === nom)?.pages ?? null;
console.log(
  JSON.stringify(
    {
      adaptateur: gpu.adaptateur ?? null,
      compilation: gpu.compilation ?? [],
      erreurs: gpu.erreurs ?? [],
      indisponible: gpu.indisponible ?? null,
      resultats: gpu.resultats,
    },
    null,
    2,
  ),
);

assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
assert.deepEqual(gpu.compilation ?? [], []);
assert.deepEqual(gpu.erreurs ?? [], []);

assert.deepEqual(pages('large:exacte'), [0], 'witness: face-on and far, the page is kept');
assert.deepEqual(
  pages('large:recomposee'),
  [0],
  'witness: the recomposed pack is sound, it is kept in the wide view',
);
assert.deepEqual(
  pages('etroite:exacte'),
  [0],
  'the requested matrix carries the page into the narrow view',
);
assert.deepEqual(
  pages('etroite:recomposee'),
  [],
  'defect 2: TRS recomposition takes the page out of the frustum — the WGSL kernel does not select the same',
);

console.log(
  'OK: 2 matrices, 2 views, 4 runs of the WGSL kernel — see tests/browser/renders/cisaillement-transform.browser.ts',
);
