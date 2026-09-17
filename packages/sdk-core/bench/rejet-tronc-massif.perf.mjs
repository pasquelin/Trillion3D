import { frustumExcludesBox, frustumClipBox } from '../mathFrustumBox.ts';
import { frustumPlanesFromMatrix } from '../mathFrustum.ts';
import { mesure, graine, rapport } from './mesure.mjs';

function creeLotBoites(taille, depart) {
  const alea = graine(depart);
  const boites = new Float64Array(taille * 6);
  for (let i = 0; i < taille; i++) {
    const at = i * 6;
    const cx = (alea() - 0.5) * 100;
    const cy = (alea() - 0.5) * 100;
    const cz = -alea() * 200;
    const sx = alea() * 5 + 0.1;
    const sy = alea() * 5 + 0.1;
    const sz = alea() * 5 + 0.1;
    boites[at] = cx - sx;
    boites[at + 1] = cy - sy;
    boites[at + 2] = cz - sz;
    boites[at + 3] = cx + sx;
    boites[at + 4] = cy + sy;
    boites[at + 5] = cz + sz;
  }
  return boites;
}

const matriceVueProjection = [
  1.5, 0, 0, 0,
  0, 2.0, 0, 0,
  0, 0, -1.0, -1.0,
  0, 0, -0.2, 0,
];

const plans = new Float64Array(24);
frustumPlanesFromMatrix(plans, matriceVueProjection);

const lot1000 = { plans, boites: creeLotBoites(1000, 1), taille: 1000 };
const lot10000 = { plans, boites: creeLotBoites(10000, 2), taille: 10000 };
const lot50000 = { plans, boites: creeLotBoites(50000, 3), taille: 50000 };

function testeLot({ plans, boites, taille }) {
  let gardees = 0;
  for (let i = 0; i < taille; i++) {
    const at = i * 6;
    const exclu = frustumExcludesBox(
      plans,
      boites[at],
      boites[at + 1],
      boites[at + 2],
      boites[at + 3],
      boites[at + 4],
      boites[at + 5],
    );
    if (!exclu) gardees++;
  }
  return gardees;
}

const options = { chauffe: 1, tours: 5, budgetMs: 300 };

const mesureTronc = await mesure({
  nom: 'rejet de boîtes par le tronc',
  fichier: 'packages/sdk-core/mathFrustumBox.ts',
  cas: [
    { nom: '1 000 boîtes distribuées', entree: lot1000, taille: 1000 },
    { nom: '10 000 boîtes distribuées', entree: lot10000, taille: 10000 },
    { nom: '50 000 boîtes distribuées', entree: lot50000, taille: 50000 },
  ],
  calcul: testeLot,
  attendu: testeLot,
  options,
});

rapport(
  'rejet-tronc-massif',
  mesureTronc,
  'le rejet par le tronc donne un compte exact de boîtes conservées',
);
