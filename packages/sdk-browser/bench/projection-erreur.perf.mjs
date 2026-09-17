// Banc de performance : calcul géométrique de projection d'erreur et plancher de coupure.
import { projectedErrorAt, errorFloorAt } from '../pageSelectionProjection.ts';
import { graine, mesure, rapport } from '../../sdk-core/bench/mesure.mjs';

function creeLotSpheres(taille) {
  const alea = graine(123);
  const donnees = new Float64Array(taille * 4);
  for (let i = 0; i < taille; i++) {
    const at = i * 4;
    donnees[at] = alea() * 25;
    donnees[at + 1] = alea() * 100 + 1;
    donnees[at + 2] = 0.5 + alea() * 5;
    donnees[at + 3] = alea() * 2;
  }
  return { donnees, taille };
}

const lot1000 = creeLotSpheres(1000);
const lot10000 = creeLotSpheres(10000);
const lot50000 = creeLotSpheres(50000);

function executeProjections({ donnees, taille }) {
  let somme = 0;
  const stretch = 1.0, focal = 1000.0, near = 0.1;
  for (let i = 0; i < taille; i++) {
    const at = i * 4;
    const lateral = donnees[at];
    const depth = donnees[at + 1];
    const radius = donnees[at + 2];
    const error = donnees[at + 3];
    const proj = projectedErrorAt(error, lateral, depth, radius, stretch, focal, near);
    const floor = errorFloorAt(error, depth, radius, stretch, focal);
    if (proj > floor) somme++;
  }
  return somme;
}

const options = { chauffe: 1, tours: 5, budgetMs: 300 };

const mesureProjection = await mesure({
  nom: 'projection erreur et plancher',
  fichier: 'packages/sdk-browser/pageSelectionProjection.ts',
  cas: [
    { nom: '1 000 sphères de clusters', entree: lot1000, taille: 1000 },
    { nom: '10 000 sphères de clusters', entree: lot10000, taille: 10000 },
    { nom: '50 000 sphères de clusters', entree: lot50000, taille: 50000 },
  ],
  calcul: executeProjections,
  attendu: executeProjections,
  options,
});

rapport(
  'projection-erreur',
  mesureProjection,
  'la projection d’erreur minore toujours strictement le plancher calculé',
);
