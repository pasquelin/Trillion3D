// Banc de performance : calcul géométrique d'intersection rayon/surfaces.
import { packSurface, intersectSurface, SURFACE_STRIDE } from '../lightingTransportIntersections.ts';
import { mesure, graine, rapport } from './mesure.mjs';

function creeSurfacesEtRayons(nbRayons) {
  const alea = graine(12345);
  const surfacesBuffer = new Float64Array(SURFACE_STRIDE * 4);
  const surfaces = [
    { origin: [-1, -1, -5], u: [2, 0, 0], v: [0, 2, 0] },
    { origin: [-2, -1, -10], u: [4, 0, 0], v: [0, 4, 0] },
    { origin: [-5, -5, -15], u: [10, 0, 0], v: [0, 10, 0] },
    { origin: [0, 0, -20], u: [5, 0, 0], v: [0, 5, 0] },
  ];
  for (let s = 0; s < 4; s++) packSurface(surfaces[s], surfacesBuffer, s * SURFACE_STRIDE);

  const rays = new Float64Array(nbRayons * 6);
  for (let i = 0; i < nbRayons; i++) {
    const at = i * 6;
    rays[at] = (alea() - 0.5) * 2;
    rays[at + 1] = (alea() - 0.5) * 2;
    rays[at + 2] = 0;
    const dx = (alea() - 0.5) * 0.5;
    const dy = (alea() - 0.5) * 0.5;
    const dz = -1;
    const invLen = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
    rays[at + 3] = dx * invLen;
    rays[at + 4] = dy * invLen;
    rays[at + 5] = dz * invLen;
  }
  return { surfacesBuffer, rays, nbRayons };
}

const lot1000 = creeSurfacesEtRayons(1000);
const lot5000 = creeSurfacesEtRayons(5000);
const lot20000 = creeSurfacesEtRayons(20000);

function compteIntersections({ surfacesBuffer, rays, nbRayons }) {
  const scratch = new Float64Array(4);
  let touches = 0;
  for (let i = 0; i < nbRayons; i++) {
    const rAt = i * 6;
    for (let s = 0; s < 4; s++) {
      if (intersectSurface(surfacesBuffer, s * SURFACE_STRIDE, rays, rAt, 100, scratch)) {
        touches++;
      }
    }
  }
  return touches;
}

const options = { chauffe: 1, tours: 5, budgetMs: 300 };

const mesureRayons = await mesure({
  nom: 'intersections rayons-surfaces',
  fichier: 'packages/sdk-core/lightingTransportIntersections.ts',
  cas: [
    { nom: '1 000 rayons testés sur 4 surfaces', entree: lot1000, taille: 1000 },
    { nom: '5 000 rayons testés sur 4 surfaces', entree: lot5000, taille: 5000 },
    { nom: '20 000 rayons testés sur 4 surfaces', entree: lot20000, taille: 20000 },
  ],
  calcul: compteIntersections,
  attendu: compteIntersections,
  options,
});

rapport(
  'rayons-surfaces',
  mesureRayons,
  'les intersections rayons/surfaces rendent un compte déterministe au bit près',
);
