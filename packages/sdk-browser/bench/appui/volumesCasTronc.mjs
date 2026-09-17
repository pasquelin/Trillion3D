// Cas d'équivalence du lot M2, tronc de vue et cône : plans, test de boîte, plans en repère local et
// rejet de cône de `sdk-core` contre Three.js, sur les entrées hostiles de `scenesVolumes.mjs`. Le
// test à trois états est aussi opposé à l'ancien `boxClip` dans l'ordre de plans d'avant : réordonner
// les plans ne change aucun verdict. Seule la colonne « identique » décide, au bit près.
import * as THREE from 'three';
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
import {
  plansThree,
  referenceClipPlanes,
  referenceConeRejects,
  referencePlanesToLocal,
  reordonne,
  troncThree,
} from '../oracles/volumes.mjs';

const un = (nom, entree) => [{ nom, entree, taille: entree.length }];
const deux = (nom, entree, nomH, entreeH) => [...un(nom, entree), ...un(nomH, entreeH)];
const plans = (vp, webgpu, Type = Float64Array) => {
  const sortie = new Type(24);
  frustumPlanesFromMatrix(sortie, vp);
  return sortie;
};
/** Les plans simple précision des uniformes de sélection, ramenés sous chaque placement. */
const locaux = (vues, mondes, pas) =>
  vues.flatMap(({ vp, webgpu }, v) =>
    mondes
      .filter((_, j) => j % pas === v % pas)
      .map((m) => ({ planes: plans(vp, webgpu, Float32Array), m })),
  );

/** Les lignes d'équivalence du tronc et du cône, sans options de chronomètre. */
export const casTronc = [
  {
    calcul: "plans normalisés du tronc d'une vue-projection",
    // L'oracle Three date d'avant la convention de profondeur inversée (Z inversé, plan
    // lointain infini) : il ne décrit plus la même sortie. La justesse de ce calcul est
    // tenue par `mathFrustum.test.ts` et `mathFrustumBox.test.ts`.
    oraclePerime: 'oracle Three d’avant le Z inversé — justesse dans mathFrustum.test.ts',
    fichier: 'packages/sdk-core/mathFrustum.ts',
    cas: deux(
      'vues WebGL, WebGPU et hostiles',
      vuesProjections,
      'caméras dans la hiérarchie',
      vuesHierarchiques,
    ),
    reference: (liste) =>
      liste.flatMap(({ vp, webgpu }) => {
        const tronc = troncThree(vp, webgpu);
        return [plansThree(tronc, Float64Array), plansThree(tronc, Float32Array)];
      }),
    optimisee: (liste) =>
      liste.flatMap(({ vp, webgpu }) => [plans(vp, webgpu), plans(vp, webgpu, Float32Array)]),
  },
  {
    calcul: "plans bruts d'une matrice de découpe",
    // L'oracle Three date d'avant la convention de profondeur inversée (Z inversé, plan
    // lointain infini) : il ne décrit plus la même sortie. La justesse de ce calcul est
    // tenue par `mathFrustum.test.ts` et `mathFrustumBox.test.ts`.
    oraclePerime: 'oracle Three d’avant le Z inversé — justesse dans mathFrustum.test.ts',
    fichier: 'packages/sdk-core/mathFrustum.ts',
    cas: deux(
      'vues WebGL, WebGPU et hostiles',
      vuesProjections,
      'caméras dans la hiérarchie',
      vuesHierarchiques,
    ),
    reference: (liste) => liste.map(({ vp }) => Float64Array.from(referenceClipPlanes(vp))),
    optimisee: (liste) =>
      liste.map(({ vp }) => {
        const sortie = new Float64Array(24);
        clipPlanesFromMatrix(sortie, vp);
        return sortie;
      }),
  },
  {
    calcul: 'boîte hors du tronc',
    // L'oracle Three date d'avant la convention de profondeur inversée (Z inversé, plan
    // lointain infini) : il ne décrit plus la même sortie. La justesse de ce calcul est
    // tenue par `mathFrustum.test.ts` et `mathFrustumBox.test.ts`.
    oraclePerime: 'oracle Three d’avant le Z inversé — justesse dans mathFrustum.test.ts',
    fichier: 'packages/sdk-core/mathFrustumBox.ts',
    cas: deux(
      'boîtes par vue, plan proche traversé',
      boitesDeVue,
      'boîtes monde et caméras hiérarchiques',
      boitesDeVueHierarchiques,
    ),
    reference: (liste) =>
      liste.map(
        ({ vp, webgpu, boite: b }) =>
          !troncThree(vp, webgpu).intersectsBox(
            new THREE.Box3(
              new THREE.Vector3(b[0], b[1], b[2]),
              new THREE.Vector3(b[3], b[4], b[5]),
            ),
          ),
      ),
    optimisee: (liste) =>
      liste.map(({ vp, webgpu, boite: b }) =>
        frustumExcludesBox(plans(vp, webgpu), b[0], b[1], b[2], b[3], b[4], b[5]),
      ),
  },
  {
    calcul: 'boîte contre le tronc en trois états',
    fichier: 'packages/sdk-core/mathFrustumBox.ts',
    cas: deux(
      'boîtes par vue, plans bruts et normalisés',
      boitesDeVue,
      'boîtes monde et caméras hiérarchiques',
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
    calcul: 'plans du tronc en repère local',
    fichier: 'packages/sdk-core/mathFrustum.ts',
    cas: deux(
      'plans × placements hostiles',
      locaux(vuesProjections, matrices, 11),
      'plans × matrices monde hiérarchiques',
      locaux(vuesHierarchiques, mondesHierarchiques, 3),
    ),
    reference: (liste) =>
      liste.map(({ planes, m }) => Float64Array.from(referencePlanesToLocal(planes, m))),
    optimisee: (liste) =>
      liste.map(({ planes, m }) => {
        const sortie = new Float64Array(24);
        frustumPlanesToLocal(sortie, planes, m);
        return sortie;
      }),
  },
  {
    calcul: "rejet d'une boîte par son cône de normales",
    fichier: 'packages/sdk-core/mathCone.ts',
    cas: deux(
      'cônes, placements conformes, œil dans la sphère',
      casCones,
      'cônes sous matrices monde hiérarchiques',
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
