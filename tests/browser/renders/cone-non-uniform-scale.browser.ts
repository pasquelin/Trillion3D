// Defect 1 (cone rejection at small scale): the WGSL kernel actually run in Chromium WebGPU must
// keep the reproduction's trigger case (non-uniform scale 1e-8/1e-6/1e-6, two real triangles)
// and keep rejecting a conformal cluster (uniform scale and rotation) whose face is back to the
// camera, as before this batch. `selectionGpu` comes from
// `tests/browser/probes/selectionKernelGpu.ts`.
//
// node --experimental-strip-types tests/browser/renders/cone-non-uniform-scale.browser.ts
import assert from 'node:assert/strict';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { OPEN_CONE } from '../../../packages/sdk-browser/src/page/cone/cone.ts';
import {
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../../packages/sdk-browser/src/gpu/dag/selection.ts';
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import type { DagRoot } from '../../../packages/sdk-browser/src/gpu/dag/types.ts';
import type { NormalCone } from '../../../packages/sdk-browser/src/page/cone/cone.ts';
import { selectionGpu } from '../probes/selectionKernelGpu.ts';
import { triggerCase } from '../probes/coneNonUniformScaleCase.ts';

const VIEWPORT: [number, number] = [1000, 1000];

interface PageCasCone {
  sphere: number[];
  min: number[];
  max: number[];
  cone: NormalCone;
}

/** The page packed IN THE RENDER FRAME of `uniforms` — the eye is its origin — as the frame
 *  input carries it to the GPU. Packing in absolute world under a relative view would mix two
 *  frames in the same formula, and both frustum and cone would cut wrongly. */
function empaquete(
  world: G.Matrix4,
  page: PageCasCone,
  uniforms: { cameraWorld: [number, number, number] },
) {
  return packedWorldsToRenderOrigin(
    packDagSelection([{ world, pages: [{ url: '0', lodError: 0, parentError: null, ...page }] }]),
    [{ world, pages: [] } satisfies DagRoot],
    uniforms.cameraWorld,
  );
}

/** Trigger case: two real triangles, scale (1e-8, 1e-6, 1e-6), visible and large face —
 *  identical to `tests/browser/probes/cone-non-uniform-scale.ts`. */
function casDeclencheur() {
  const { cone, min, max, world, camera } = triggerCase();
  const sphere = [0, 0, -0.5, 2];
  const uniforms = cameraSelectionUniforms(cameraMoteur(camera), 0, VIEWPORT);
  return {
    nom: 'declencheur',
    uniforms,
    avecCone: empaquete(world, { sphere, min, max, cone }, uniforms),
    sansCone: empaquete(world, { sphere, min, max, cone: OPEN_CONE }, uniforms),
  };
}

/** Hostile conformal case: uniform scale and rotation, a box back to the camera must stay
 *  rejected exactly as before this batch — the fix does not loosen conformal rejection. */
function casConformeDosCamera() {
  const cone: NormalCone = { axis: [0, 0, 1], angle: Math.PI / 6 };
  const world = new G.Matrix4().compose(
    new G.Vector3(2, -1, 3),
    new G.Quaternion().setFromEuler(new G.Euler(0.3, -0.5, 0.2)),
    new G.Vector3(50, 50, 50),
  );
  const min = [-1, -1, -1],
    max = [1, 1, 1];
  const centre = new G.Vector3(0, 0, 0).applyMatrix4(world);
  const normal = new G.Matrix3().getNormalMatrix(world);
  const axeMonde = new G.Vector3(...cone.axis).applyMatrix3(normal).normalize();
  const camera = G.perspectiveCamera(55, 1, 0.1, 100000);
  camera.position.copy(axeMonde).multiplyScalar(-500).add(centre);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);
  const sphere = [...centre.toArray(), 3];
  const uniforms = cameraSelectionUniforms(cameraMoteur(camera), 0, VIEWPORT);
  return {
    nom: 'conformeDosCamera',
    uniforms,
    avecCone: empaquete(world, { sphere, min, max, cone }, uniforms),
    sansCone: empaquete(world, { sphere, min, max, cone: OPEN_CONE }, uniforms),
  };
}

const cas = [casDeclencheur(), casConformeDosCamera()];
const appels = cas.flatMap((c) => [
  { name: `${c.nom}:avecCone`, packed: c.avecCone, uniforms: c.uniforms },
  { name: `${c.nom}:sansCone`, packed: c.sansCone, uniforms: c.uniforms },
]);
const gpu = await selectionGpu(appels);
const pages = (nom: string) =>
  gpu.resultats?.find((r: { name: string }) => r.name === nom)?.pages ?? null;
const indisponible = gpu.indisponible ?? null;
console.log(
  JSON.stringify(
    {
      adaptateur: gpu.adaptateur ?? null,
      compilation: gpu.compilation ?? [],
      erreurs: gpu.erreurs ?? [],
      indisponible,
      resultats: gpu.resultats,
    },
    null,
    2,
  ),
);

assert.equal(indisponible, null, String(indisponible));
assert.deepEqual(gpu.compilation ?? [], []);
assert.deepEqual(gpu.erreurs ?? [], []);

assert.deepEqual(pages('declencheur:sansCone'), [0], 'witness: without cone, the page stays');
assert.deepEqual(
  pages('declencheur:avecCone'),
  [0],
  'defect 1: the WGSL kernel rejects the page even though it is visible at small non-uniform scale',
);

assert.deepEqual(
  pages('conformeDosCamera:sansCone'),
  [0],
  'witness: without cone, the conformal back-facing page stays',
);
assert.deepEqual(
  pages('conformeDosCamera:avecCone'),
  [],
  'a conformal cluster whose face is back to the camera must still be rejected',
);

console.log(
  'OK: 2 cases, 4 runs of the WGSL kernel — see tests/browser/renders/cone-non-uniform-scale.browser.ts',
);
