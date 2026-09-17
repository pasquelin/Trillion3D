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
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { packDagSelection, packedWorldsToRenderOrigin } from './gpuDagPack.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { cameraMoteur } from './cameraFixture.ts';
import { descenteComptee, scenePages, sceneRoots } from './gpuDagCutFrontierFixture.ts';

const pages = scenePages(16384, 8);
const roots = sceneRoots(pages, 12);
const packed = packDagSelection(roots);
const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);

/** Une image : la caméra posée, les matrices monde rebasées sur l'œil, puis la descente comptée. */
function image(x: number, z: number, deplacement: number) {
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
  return descenteComptee(packed, uniforms);
}

const REGIMES: Array<[string, (i: number) => ReturnType<typeof image>]> = [
  ['pose immobile', () => image(0, 16, 0)],
  ['caméra qui glisse', (i) => image(i * 0.25, 16, 0)],
  ['saut de caméra', (i) => image((i % 2 ? 1 : -1) * 9, i % 2 ? 40 : 14, 0)],
  ['scène animée', (i) => image(0, 16, (i % 5) * 0.4)],
];

test("la frontière de la descente est ce qu'aucune persistance exacte ne peut économiser", () => {
  const lignes = REGIMES.map(([nom, poser]) => {
    let visites = 0,
      internes = 0,
      feuilles = 0,
      rejetees = 0,
      candidats = 0;
    for (let i = 0; i < 8; i++) {
      const compte = poser(i);
      visites += compte.visites;
      internes += compte.internes;
      feuilles += compte.frontiereFeuilles;
      rejetees += compte.frontiereRejetees;
      candidats += compte.candidats;
    }
    const frontiere = feuilles + rejetees;
    assert.equal(visites, internes + frontiere, 'un nœud visité est interne ou sur la frontière');
    assert.ok(candidats > 0, `${nom} doit voir de la géométrie`);
    return {
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
    };
  });
  console.log(
    JSON.stringify({ pages: packed.pageCount, noeuds: packed.nodeCount, lignes }, null, 2),
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
  }
});
