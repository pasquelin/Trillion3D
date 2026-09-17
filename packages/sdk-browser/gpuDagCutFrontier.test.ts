// Ce que la descente relit à chaque image, et ce qu'une sélection persistante pourrait en garder.
//
// Une coupe gardée d'une image à l'autre ne peut économiser que les nœuds INTERNES : la frontière —
// là où la descente s'arrête — doit être réexaminée à chaque image, l'erreur écran de chaque nœud
// changeant dès que la caméra bouge. Le seul autre travail qu'elle éviterait est le test du parent
// d'un nœud REJETÉ, seul cas où la coupe peut se refermer : un nœud retenu a forcément un parent
// retenu, les deux rejets étant monotones vers le bas.
//
// Ce fichier mesure les deux parts, sur quatre régimes dont les deux défavorables que la persistance
// doit affronter : le saut de caméra et la scène animée.
//
// Il mesure aussi l'AUTRE moitié du problème, celle que la persistance ne touche pas : le rejet par
// le haut. La descente de la carte ne porte que le plafond d'erreur du remplaçant, donc elle ne sait
// écarter qu'un sous-arbre trop fin ; la coupe processeur écarte aussi le trop grossier, avec des
// bornes que `cullingBounds` dérive des pages à la préparation — rien du compilateur, rien du format.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { packDagSelection, packedWorldsToRenderOrigin } from './gpuDagPack.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { cameraMoteur } from './cameraFixture.ts';
import { descenteComptee } from './gpuDagCutFrontierFixture.ts';
import { scenePages, sceneRoots } from './gpuDagCutFrontierScene.ts';
import { cullingBounds } from './pageSelectionCutBounds.ts';

const pages = scenePages(16384, 8);
/**
 * Deux hiérarchies, parce que le rejet par le haut ne vaut pas la même chose sur les deux : celle
 * que le rangement donne à une primitive sans manifeste (`flatHierarchy`, tranches de pages dans
 * l'ordre du tableau) et celle que le compilateur produit (`build_culling_bvh`, un nœud par étage de
 * détail sous la racine). La seconde est PURE PAR ÉTAGE, la première non.
 */
function montage(parNiveaux: boolean) {
  const roots = sceneRoots(
    pages,
    Array.from({ length: 12 }, () => new THREE.Matrix4()),
    parNiveaux,
  );
  // Les bornes que la coupe processeur dérive déjà de ses pages à la préparation, sans toucher au
  // format du manifeste (`pageSelectionCutBounds.ts`) : toutes les poses partagent une hiérarchie,
  // donc un seul jeu. La descente de la carte ne les reçoit pas — c'est ce qu'on mesure.
  return {
    roots,
    packed: packDagSelection(roots),
    bornes: cullingBounds(roots[0].culling!, pages),
  };
}
const MONTAGES = [
  ['hiérarchie du rangement', montage(false)],
  ['hiérarchie du compilateur (un nœud par étage)', montage(true)],
] as const;
const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);

/** Une image : la caméra posée, les matrices monde rebasées sur l'œil, puis la descente comptée. */
function image(
  m: (typeof MONTAGES)[number][1],
  x: number,
  z: number,
  deplacement: number,
  bornes: Float64Array | undefined,
) {
  const { roots, packed } = m;
  for (let w = 0; w < roots.length; w++)
    roots[w].world.makeTranslation(
      (w % 4) * 6.5 - 9.75 + deplacement,
      Math.floor(w / 4) * 6.5 - 6.5,
      0,
    );
  cam.position.set(x, 0, z);
  cam.lookAt(x, 0, 0);
  cam.updateMatrixWorld();
  const uniforms = cameraSelectionUniforms(cameraMoteur(cam), 1, [1280, 720]);
  packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld);
  return descenteComptee(packed, uniforms, bornes);
}

type Poser = (
  m: (typeof MONTAGES)[number][1],
  i: number,
  bornes: Float64Array | undefined,
) => ReturnType<typeof image>;
const REGIMES: Array<[string, Poser]> = [
  ['pose immobile', (m, _i, b) => image(m, 0, 16, 0, b)],
  ['caméra qui glisse', (m, i, b) => image(m, i * 0.25, 16, 0, b)],
  ['saut de caméra', (m, i, b) => image(m, (i % 2 ? 1 : -1) * 9, i % 2 ? 40 : 14, 0, b)],
  ['scène animée', (m, i, b) => image(m, 0, 16, (i % 5) * 0.4, b)],
];

test("la frontière de la descente est ce qu'aucune persistance exacte ne peut économiser", () => {
  const lignes = MONTAGES.flatMap(([hierarchie, m]) =>
    REGIMES.map(([nom, poser]) => {
      let visites = 0,
        internes = 0,
        feuilles = 0,
        rejetees = 0,
        candidats = 0,
        plancherCoupe = 0,
        candidatsAvecPlancher = 0,
        tropGrossieres = 0;
      for (let i = 0; i < 8; i++) {
        const compte = poser(m, i, undefined);
        visites += compte.visites;
        internes += compte.internes;
        feuilles += compte.frontiereFeuilles;
        rejetees += compte.frontiereRejetees;
        candidats += compte.candidats;
        tropGrossieres += compte.tropGrossieres;
        // La même image, la même caméra, avec le rejet par le haut : c'est la SEULE différence.
        const avec = poser(m, i, m.bornes);
        plancherCoupe += avec.plancherCoupe;
        candidatsAvecPlancher += avec.candidats;
      }
      const frontiere = feuilles + rejetees;
      assert.equal(visites, internes + frontiere, 'un nœud visité est interne ou sur la frontière');
      assert.ok(candidats > 0, `${nom} doit voir de la géométrie`);
      return {
        hierarchie,
        regime: nom,
        visitesParImage: visites / 8,
        frontiereParImage: frontiere / 8,
        internesParImage: internes / 8,
        candidatsParImage: candidats / 8,
        // Le plafond d'une persistance exacte : les internes, plus le test du parent d'un nœud rejeté,
        // un par fratrie de huit. Rapporté à tout ce que l'image relit, nœuds et grappes candidates.
        plafondPourCent: Number(
          ((100 * (internes + rejetees / 8)) / (visites + candidats)).toFixed(2),
        ),
        // Le rejet PAR LE HAUT, celui que la coupe processeur pose déjà : les nœuds dont aucune
        // grappe du sous-arbre n'est assez fine, et les candidates qu'ils portent.
        plancherNoeudsParImage: plancherCoupe / 8,
        candidatesRetireesParImage: (candidats - candidatsAvecPlancher) / 8,
        candidatesTropGrossieresParImage: tropGrossieres / 8,
        partDuVisePourCent: Number(
          ((100 * (candidats - candidatsAvecPlancher)) / Math.max(1, tropGrossieres)).toFixed(1),
        ),
        candidatesRestantesPourCent: Number(
          (100 * (candidatsAvecPlancher / Math.max(1, candidats))).toFixed(1),
        ),
      };
    }),
  );
  console.log(
    JSON.stringify(
      {
        pages: MONTAGES[0][1].packed.pageCount,
        noeuds: MONTAGES.map(([nom, m]) => `${nom} : ${m.packed.nodeCount}`),
        lignes,
      },
      null,
      2,
    ),
  );
  for (const ligne of lignes) {
    // La frontière est la quasi-totalité de la descente : dans un arbre à huit enfants les internes
    // valent environ un septième de ce qu'ils portent, un peu plus près de la racine où les nœuds ne
    // sont pas pleins. Ce que le seuil retient, c'est l'ordre de grandeur : jamais un sixième.
    assert.ok(
      ligne.internesParImage * 6 <= ligne.frontiereParImage,
      `${ligne.regime} : internes ${ligne.internesParImage} pour une frontière de ${ligne.frontiereParImage}`,
    );
    assert.ok(ligne.plafondPourCent < 5, `${ligne.regime} : plafond ${ligne.plafondPourCent} %`);
    // Le rejet par le haut est SÛR : il ne retire jamais qu'une candidate réellement trop grossière.
    assert.ok(
      ligne.candidatesRetireesParImage > 0 &&
        ligne.candidatesRetireesParImage <= ligne.candidatesTropGrossieresParImage,
      `${ligne.regime} : ${ligne.candidatesRetireesParImage} retirées pour ${ligne.candidatesTropGrossieresParImage} trop grossières`,
    );
  }
});
