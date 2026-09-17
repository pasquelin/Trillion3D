// GEO-2 : transparents en quelques ordres - passes de mélange et repli.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { cote, FACES, glisse, ITEMS, pose, regimes } from './appui/scenesTransparents.mjs';
import { appelsEncodes, tours } from './appui/toursTransparents.mjs';
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
const resultats = [];
for (const scene of scenes) {
  for (const [regime, images] of regimes) {
    resultats.push(
      await mesure({
        nom: `ordres et arguments — ${scene.nom}, ${regime}`,
        fichier: 'packages/sdk-browser/webgpuBlendDraw.ts',
        cas: casDe(images),
        calcul: scene.tourApres,
        attendu: scene.tourAvant,
        options: { tours: 20, budgetMs: 1500 },
      }),
    );
    resultats.push(
      await mesure({
        nom: `repli processeur — ${scene.nom}, ${regime}`,
        fichier: 'packages/sdk-browser/webgpuBlendExpandCpu.ts',
        cas: casDe(images),
        calcul: scene.tourApresSeq,
        attendu: scene.tourAvantSeq,
        options: { tours: 20, budgetMs: 1500 },
      }),
    );
  }
}

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
  assert.ok(comptes[0].apres < comptes[0].avant / 100, 'simple face : quelques ordres');
  assert.equal(comptes[1].apres, comptes[1].avant, 'double face : aucun appel retiré');
});

await stress({
  nom: 'blend draw extremes',
  calcul: (imgs) => scenes[0].tourApres(imgs),
  extremes: [{ nom: 'glisse standard', entree: glisse.slice(0, 1) }],
});

rapport(
  'transparents-ordres',
  resultats,
  'GEO-2 : les deux chemins peignent les mêmes plages, dans le même ordre',
);
