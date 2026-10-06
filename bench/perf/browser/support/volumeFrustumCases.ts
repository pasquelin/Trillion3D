// Equivalence cases of batch M2, view frustum and cone: planes, box test, local-space planes
// and cone reject of `sdk-core` against Three.js, on the hostile inputs of `scenesVolumes.ts`.
// The three-state test is also opposed to the old `boxClip` in the previous plane order:
// reordering the planes changes no verdict. Only the "identical" column decides, bit-exact.
import {
  boxConeRejects,
  clipPlanesFromMatrix,
  frustumClipBox,
  frustumExcludesBox,
} from '../../../../packages/sdk-core/src/index.ts';
import { frustumPlanesToLocal } from '../../../../packages/sdk-browser/src/gpu/dag/oracle/math.fixture.ts';
import type { MeasureCase } from '../../../core/index.ts';
import { viewBoxes, casCones, matrices, projectionViews } from './scenesVolumes.ts';
import type { ConeCase, ViewBoxCase, ViewProjectionCase } from './scenesVolumes.ts';
import {
  hierarchicalViewBoxes,
  hierarchicalCones,
  hierarchicalWorlds,
  hierarchicalViews,
} from './scenesHierarchies.ts';
import { referenceBoxClip } from '../../../oracles/browser/selection.ts';
import {
  referenceConeRejects,
  referencePlanesToLocal,
  reordonne,
} from '../../../oracles/browser/volumes.ts';
import { casVolume, un, type CasVolume } from './volumeCase.ts';
import { plans } from './volumeFrustumPlaneCases.ts';

const two = <Entree>(
  name: string,
  input: Entree[],
  nomH: string,
  entreeH: Entree[],
): MeasureCase<Entree[]>[] => [...un(name, input), ...un(nomH, entreeH)];

interface LocalPlaneCase {
  planes: Float32Array;
  m: number[];
}

/** Single-precision planes of the selection uniforms, brought under each placement. */
const locaux = (views: { vp: number[] }[], worlds: number[][], pas: number): LocalPlaneCase[] =>
  views.flatMap(({ vp }, v) =>
    worlds
      .filter((_, j) => j % pas === v % pas)
      .map((m) => ({ planes: plans(vp, Float32Array), m })),
  );

/** Equivalence lines of the frustum and the cone, without timer options. */
// The Three oracle of these three computations predates the reversed-depth convention
// (reversed Z, infinite far plane): it no longer describes the same output. Their
// correctness is held by `bench/witnesses/three/parity/core/math/frustum/frustum.test.ts` and `bench/witnesses/three/parity/core/math/frustum/box.test.ts`, and the bench
// line publishes it.
const Z_INVERSE =
  'Three oracle from before reversed Z — correctness in bench/witnesses/three/parity/core/math/frustum/frustum.test.ts';

export const casTronc: CasVolume[] = [
  casVolume({
    calculation: 'normalized frustum planes of a view-projection',
    motif: Z_INVERSE,
    fichier: 'packages/sdk-core/src/math/frustum/frustum.ts',
    cas: two(
      'vues WebGL, WebGPU et hostiles',
      projectionViews,
      'cameras in the hierarchy',
      hierarchicalViews,
    ),
    optimised: (list: ViewProjectionCase[]) =>
      list.flatMap(({ vp }) => [plans(vp), plans(vp, Float32Array)]),
  }),
  casVolume({
    calculation: 'raw planes of a clip matrix',
    motif: Z_INVERSE,
    fichier: 'packages/sdk-core/src/math/frustum/frustum.ts',
    cas: two(
      'vues WebGL, WebGPU et hostiles',
      projectionViews,
      'cameras in the hierarchy',
      hierarchicalViews,
    ),
    optimised: (list: ViewProjectionCase[]) =>
      list.map(({ vp }) => {
        const output = new Float64Array(24);
        clipPlanesFromMatrix(output, vp);
        return output;
      }),
  }),
  casVolume({
    calculation: 'box outside the frustum',
    motif: Z_INVERSE,
    fichier: 'packages/sdk-core/src/math/frustum/box.ts',
    cas: two(
      'boxes per view, near plane crossed',
      viewBoxes,
      'world boxes and hierarchical cameras',
      hierarchicalViewBoxes,
    ),
    optimised: (list: ViewBoxCase[]) =>
      list.map(({ vp, box: b }) =>
        frustumExcludesBox(plans(vp), b[0], b[1], b[2], b[3], b[4], b[5]),
      ),
  }),
  casVolume({
    calculation: 'box against the frustum in three states',
    fichier: 'packages/sdk-core/src/math/frustum/box.ts',
    cas: two(
      'boxes per view, raw and normalized planes',
      viewBoxes,
      'world boxes and hierarchical cameras',
      hierarchicalViewBoxes,
    ),
    reference: (list: ViewBoxCase[]) =>
      list.map(({ vp, box: b }) => {
        const brut = new Float64Array(24);
        clipPlanesFromMatrix(brut, vp);
        return [
          referenceBoxClip(reordonne(brut), b[0], b[1], b[2], b[3], b[4], b[5]),
          referenceBoxClip(reordonne(plans(vp)), b[0], b[1], b[2], b[3], b[4], b[5]),
        ];
      }),
    optimised: (list: ViewBoxCase[]) =>
      list.map(({ vp, box: b }) => {
        const brut = new Float64Array(24);
        clipPlanesFromMatrix(brut, vp);
        return [
          frustumClipBox(brut, b[0], b[1], b[2], b[3], b[4], b[5]),
          frustumClipBox(plans(vp), b[0], b[1], b[2], b[3], b[4], b[5]),
        ];
      }),
  }),
  casVolume({
    calculation: 'frustum planes in local space',
    fichier: 'packages/sdk-core/src/math/frustum/frustum.ts',
    cas: two(
      'plans × placements hostiles',
      locaux(projectionViews, matrices, 11),
      'planes × hierarchical world matrices',
      locaux(hierarchicalViews, hierarchicalWorlds, 3),
    ),
    reference: (list: LocalPlaneCase[]) =>
      list.map(({ planes, m }) => Float64Array.from(referencePlanesToLocal(planes, m))),
    optimised: (list: LocalPlaneCase[]) =>
      list.map(({ planes, m }) => {
        const output = new Float64Array(24);
        frustumPlanesToLocal(output, planes, m);
        return output;
      }),
  }),
  casVolume({
    calculation: 'rejection of a box by its normal cone',
    fichier: 'packages/sdk-core/src/math/primitives/cone.ts',
    cas: two(
      'cones, conformal placements, eye in the sphere',
      casCones,
      'cones under hierarchical world matrices',
      hierarchicalCones,
    ),
    reference: (list: ConeCase[]) =>
      list.map((c) =>
        referenceConeRejects(
          { axis: c.axe, angle: c.angle },
          c.world,
          c.min,
          c.max,
          c.normal,
          c.scale,
          c.eye,
        ),
      ),
    optimised: (list: ConeCase[]) =>
      list.map((c) =>
        boxConeRejects(
          c.axe,
          c.angle,
          c.min,
          c.max,
          c.world.elements,
          c.normal.elements,
          c.scale,
          c.eye[0],
          c.eye[1],
          c.eye[2],
        ),
      ),
  }),
];
