// Equivalence cases of batch M2, view frustum and cone: planes, box test, local-space planes
// and cone reject of `sdk-core` against Three.js, on the hostile inputs of `scenesVolumes.mjs`.
// The three-state test is also opposed to the old `boxClip` in the previous plane order:
// reordering the planes changes no verdict. Only the "identical" column decides, bit-exact.
import {
  boxConeRejects,
  clipPlanesFromMatrix,
  frustumClipBox,
  frustumExcludesBox,
  frustumPlanesFromMatrix,
  frustumPlanesToLocal,
} from '../../../sdk-core/index.ts';
import { boitesDeVue, casCones, matrices, vuesProjections } from './scenesVolumes.mjs';
import {
  boitesDeVueHierarchiques,
  conesHierarchiques,
  mondesHierarchiques,
  vuesHierarchiques,
} from './scenesHierarchies.mjs';
import { referenceBoxClip } from '../oracles/selection.mjs';
import { referenceConeRejects, referencePlanesToLocal, reordonne } from '../oracles/volumes.mjs';

const un = (name, input) => [{ name, input, size: input.length }];
const deux = (name, input, nomH, entreeH) => [...un(name, input), ...un(nomH, entreeH)];
const plans = (vp, webgpu, Type = Float64Array) => {
  const output = new Type(24);
  frustumPlanesFromMatrix(output, vp);
  return output;
};
/** Single-precision planes of the selection uniforms, brought under each placement. */
const locaux = (views, mondes, pas) =>
  views.flatMap(({ vp, webgpu }, v) =>
    mondes
      .filter((_, j) => j % pas === v % pas)
      .map((m) => ({ planes: plans(vp, webgpu, Float32Array), m })),
  );

/** Equivalence lines of the frustum and the cone, without timer options. */
// The Three oracle of these three computations predates the reversed-depth convention
// (reversed Z, infinite far plane): it no longer describes the same output. Their
// correctness is held by `mathFrustum.test.ts` and `mathFrustumBox.test.ts`, and the bench
// line publishes it.
const Z_INVERSE = 'Three oracle from before reversed Z — correctness in mathFrustum.test.ts';

export const casTronc = [
  {
    calcul: 'normalized frustum planes of a view-projection',
    motif: Z_INVERSE,
    fichier: 'packages/sdk-core/mathFrustum.ts',
    cas: deux(
      'vues WebGL, WebGPU et hostiles',
      vuesProjections,
      'cameras in the hierarchy',
      vuesHierarchiques,
    ),
    optimisee: (liste) =>
      liste.flatMap(({ vp, webgpu }) => [plans(vp, webgpu), plans(vp, webgpu, Float32Array)]),
  },
  {
    calcul: 'raw planes of a clip matrix',
    motif: Z_INVERSE,
    fichier: 'packages/sdk-core/mathFrustum.ts',
    cas: deux(
      'vues WebGL, WebGPU et hostiles',
      vuesProjections,
      'cameras in the hierarchy',
      vuesHierarchiques,
    ),
    optimisee: (liste) =>
      liste.map(({ vp }) => {
        const output = new Float64Array(24);
        clipPlanesFromMatrix(output, vp);
        return output;
      }),
  },
  {
    calcul: 'box outside the frustum',
    motif: Z_INVERSE,
    fichier: 'packages/sdk-core/mathFrustumBox.ts',
    cas: deux(
      'boxes per view, near plane crossed',
      boitesDeVue,
      'world boxes and hierarchical cameras',
      boitesDeVueHierarchiques,
    ),
    optimisee: (liste) =>
      liste.map(({ vp, webgpu, boite: b }) =>
        frustumExcludesBox(plans(vp, webgpu), b[0], b[1], b[2], b[3], b[4], b[5]),
      ),
  },
  {
    calcul: 'box against the frustum in three states',
    fichier: 'packages/sdk-core/mathFrustumBox.ts',
    cas: deux(
      'boxes per view, raw and normalized planes',
      boitesDeVue,
      'world boxes and hierarchical cameras',
      boitesDeVueHierarchiques,
    ),
    reference: (liste) =>
      liste.map(({ vp, webgpu, boite: b }) => {
        const brut = new Float64Array(24);
        clipPlanesFromMatrix(brut, vp);
        return [
          referenceBoxClip(reordonne(brut), ...b),
          referenceBoxClip(reordonne(plans(vp, webgpu)), ...b),
        ];
      }),
    optimisee: (liste) =>
      liste.map(({ vp, webgpu, boite: b }) => {
        const brut = new Float64Array(24);
        clipPlanesFromMatrix(brut, vp);
        return [frustumClipBox(brut, ...b), frustumClipBox(plans(vp, webgpu), ...b)];
      }),
  },
  {
    calcul: 'frustum planes in local space',
    fichier: 'packages/sdk-core/mathFrustum.ts',
    cas: deux(
      'plans × placements hostiles',
      locaux(vuesProjections, matrices, 11),
      'planes × hierarchical world matrices',
      locaux(vuesHierarchiques, mondesHierarchiques, 3),
    ),
    reference: (liste) =>
      liste.map(({ planes, m }) => Float64Array.from(referencePlanesToLocal(planes, m))),
    optimisee: (liste) =>
      liste.map(({ planes, m }) => {
        const output = new Float64Array(24);
        frustumPlanesToLocal(output, planes, m);
        return output;
      }),
  },
  {
    calcul: 'rejection of a box by its normal cone',
    fichier: 'packages/sdk-core/mathCone.ts',
    cas: deux(
      'cones, conformal placements, eye in the sphere',
      casCones,
      'cones under hierarchical world matrices',
      conesHierarchiques,
    ),
    reference: (liste) =>
      liste.map((c) =>
        referenceConeRejects(
          { axis: c.axe, angle: c.angle },
          c.world,
          c.min,
          c.max,
          c.normal,
          c.echelle,
          c.oeil,
        ),
      ),
    optimisee: (liste) =>
      liste.map((c) =>
        boxConeRejects(
          c.axe,
          c.angle,
          c.min,
          c.max,
          c.world.elements,
          c.normal.elements,
          c.echelle,
          c.oeil[0],
          c.oeil[1],
          c.oeil[2],
        ),
      ),
  },
];
