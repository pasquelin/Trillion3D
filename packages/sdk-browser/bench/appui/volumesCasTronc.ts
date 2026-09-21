// Equivalence cases of batch M2, view frustum and cone: planes, box test, local-space planes
// and cone reject of `sdk-core` against Three.js, on the hostile inputs of `scenesVolumes.ts`.
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
import type { MesureCas } from '../../../sdk-core/bench/socle.ts';
import {
  boitesDeVue,
  casCones,
  matrices,
  vuesProjections,
  type ConeCase,
  type ViewBoxCase,
  type ViewProjectionCase,
} from './scenesVolumes.ts';
import {
  boitesDeVueHierarchiques,
  conesHierarchiques,
  mondesHierarchiques,
  vuesHierarchiques,
} from './scenesHierarchies.ts';
import { referenceBoxClip } from '../oracles/selection.ts';
import { referenceConeRejects, referencePlanesToLocal, reordonne } from '../oracles/volumes.ts';

const un = <Entree>(name: string, input: Entree[]): MesureCas<Entree[]>[] => [
  { name, input, size: input.length },
];
const deux = <Entree>(
  name: string,
  input: Entree[],
  nomH: string,
  entreeH: Entree[],
): MesureCas<Entree[]>[] => [...un(name, input), ...un(nomH, entreeH)];
const plans = (vp: number[], webgpu: boolean, Type: Float64ArrayConstructor | Float32ArrayConstructor = Float64Array) => {
  const output = new Type(24);
  frustumPlanesFromMatrix(output, vp);
  return output;
};

interface LocalPlaneCase {
  planes: Float32Array;
  m: number[];
}

/** Single-precision planes of the selection uniforms, brought under each placement. */
const locaux = (
  views: { vp: number[]; webgpu: boolean }[],
  mondes: number[][],
  pas: number,
): LocalPlaneCase[] =>
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
    optimisee: (liste: ViewProjectionCase[]) =>
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
    optimisee: (liste: ViewProjectionCase[]) =>
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
    optimisee: (liste: ViewBoxCase[]) =>
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
    reference: (liste: ViewBoxCase[]) =>
      liste.map(({ vp, webgpu, boite: b }) => {
        const brut = new Float64Array(24);
        clipPlanesFromMatrix(brut, vp);
        return [
          referenceBoxClip(reordonne(brut), b[0], b[1], b[2], b[3], b[4], b[5]),
          referenceBoxClip(reordonne(plans(vp, webgpu)), b[0], b[1], b[2], b[3], b[4], b[5]),
        ];
      }),
    optimisee: (liste: ViewBoxCase[]) =>
      liste.map(({ vp, webgpu, boite: b }) => {
        const brut = new Float64Array(24);
        clipPlanesFromMatrix(brut, vp);
        return [
          frustumClipBox(brut, b[0], b[1], b[2], b[3], b[4], b[5]),
          frustumClipBox(plans(vp, webgpu), b[0], b[1], b[2], b[3], b[4], b[5]),
        ];
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
    reference: (liste: LocalPlaneCase[]) =>
      liste.map(({ planes, m }) => Float64Array.from(referencePlanesToLocal(planes, m))),
    optimisee: (liste: LocalPlaneCase[]) =>
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
    reference: (liste: ConeCase[]) =>
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
    optimisee: (liste: ConeCase[]) =>
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
