// Lot « transparents en quelques ordres » : la passe de mélange n'encode plus un appel par item
// mais un par TRANCHE du plan trié. Référence = le code d'avant, recopié dans
// `oracles/transparents-ordres.mjs` (classement, arguments par item, encodage entrée par entrée).
//
// DEUX SCÈNES, parce que le côté du matériau décide de tout. `sidesOf` rend UNE entrée de plan pour
// un matériau simple face, et DEUX — dos puis face, deux pipelines — pour un matériau double face ;
// une tranche s'arrête quand le pipeline change. Une scène de verre ou de feuillage ne fusionne
// donc rien, et le banc le mesure au lieu de le supposer.
//
// Deux lignes par scène et par régime, parce que les deux chemins ne paient pas la même chose :
//
// - « ordres et arguments » mesure ce que le PROCESSEUR paie par image sur un appareil à étage de
//   calcul : d'un côté le classement, la réécriture des arguments de tous les items et la boucle
//   qui encode entrée par entrée ; de l'autre le classement — tronc et tranches compris — et la
//   boucle qui encode tranche par tranche. L'étalement, lui, est à la carte.
// - « repli processeur » mesure l'appareil SANS étage de calcul, qui étale le plan lui-même. Les
//   deux côtés y rendent la suite complète des plages d'indices que le rasteriseur verrait, et
//   c'est cette suite-là qui prouve l'égalité, plage par plage et mot pour mot.
//
// Le nombre d'appels de dessin, lui, n'est pas un temps : il est compté et vérifié à part, en fin
// de fichier, là où il se lit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import { cote, FACES, glisse, ITEMS, pose, regimes } from './scenesTransparents.mjs';
import { appelsEncodes, tours } from './toursTransparents.mjs';
import {
  argumentsReference,
  classementReference,
  encodeReference,
} from './oracles/transparents-ordres.mjs';

const scenes = FACES.map(([nom, side]) => {
  const avant = cote(side),
    apres = cote(side);
  return { nom, avant, apres, ...tours(avant, apres) };
});

const casDe = (images) => [
  { nom: `8 images de ${ITEMS} items`, entree: images, taille: ITEMS * 8 },
];
const lignes = [];
for (const scene of scenes)
  for (const [regime, images] of regimes) {
    lignes.push(
      await compare({
        calcul: `GEO-2 ordres et arguments — ${scene.nom}, ${regime}`,
        fichier: 'packages/sdk-browser/webgpuBlendDraw.ts',
        cas: casDe(images),
        reference: scene.tourAvant,
        optimisee: scene.tourApres,
        options: { tours: 40, budgetMs: 2000, alterne: true },
      }),
    );
    lignes.push(
      await compare({
        calcul: `GEO-2 repli processeur — ${scene.nom}, ${regime}`,
        fichier: 'packages/sdk-browser/webgpuBlendExpandCpu.ts',
        cas: casDe(images),
        reference: scene.tourAvantSeq,
        optimisee: scene.tourApresSeq,
        options: { tours: 20, budgetMs: 2000, alterne: true },
      }),
    );
  }

/**
 * LE NOMBRE D'APPELS DE DESSIN, avant et après, sur la même image : c'est le gain du lot, et il se
 * compte, il ne se chronomètre pas.
 *
 * Simple face, les items paginés partagent un pipeline, donc une tranche, et une primitive qui
 * porte ses propres tampons garde son appel en coupant la tranche de ses voisines. Double face, le
 * dos et la face posent deux pipelines à chaque item : rien ne fusionne, et le lot ne retire pas un
 * seul appel. Les deux nombres sont publiés, celui-là comme l'autre.
 */
function appelsDe(scene) {
  const image = glisse[0],
    etat = scene.avant;
  pose(etat, image);
  classementReference(etat.scene, etat.order, image.eye);
  argumentsReference(etat.scene, etat.args);
  const avant = encodeReference(etat.scene, etat.order, etat.args, etat.sortie);
  scene.tourApres([image]);
  return { nom: scene.nom, avant: avant.encoded, apres: appelsEncodes() };
}

test('GEO-2 : les appels de dessin, simple face et double face', () => {
  const comptes = scenes.map(appelsDe);
  for (const { nom, avant, apres } of comptes)
    console.log(
      `| GEO-2 appels de dessin transparents — ${nom} | \`webgpuBlendDraw.ts\` | ${avant} | ${apres} | ${(
        ((avant - apres) / avant) *
        100
      ).toFixed(1)} % | oui | ${apres < avant ? 'oui' : 'non'} |`,
    );
  assert.ok(comptes[0].apres < comptes[0].avant / 100, 'simple face : quelques ordres');
  // Double face : le banc CONSTATE que rien ne fusionne, il ne le déplore pas. Le jour où le côté
  // rasterisé passera par l'instance, c'est cette ligne-là qui tombera.
  assert.equal(comptes[1].apres, comptes[1].avant, 'double face : aucun appel retiré');
});

verifieEtDepose(
  'transparents-ordres',
  'GEO-2 : les deux chemins peignent les mêmes plages, dans le même ordre',
  lignes,
);
