// Banc de performance : file de réclamations et tri de rangs sous arrivées massives.
import { createWebgpuRowClaims } from '../webgpuRowClaims.ts';
import { mesure, graine, rapport } from '../../sdk-core/bench/mesure.mjs';

function creeScenarioArrivees(nbPages, nbReclamations) {
  const alea = graine(42);
  const pages = new Int32Array(nbReclamations);
  for (let i = 0; i < nbReclamations; i++) {
    pages[i] = Math.floor(alea() * nbPages);
  }
  return { nbPages, pages, nbReclamations };
}

const scenario1000 = creeScenarioArrivees(5000, 1000);
const scenario5000 = creeScenarioArrivees(20000, 5000);
const scenario20000 = creeScenarioArrivees(50000, 20000);

function executeReclamationsEtTri({ nbPages, pages, nbReclamations }) {
  const claims = createWebgpuRowClaims(nbPages);
  for (let i = 0; i < nbReclamations; i++) {
    claims.add(pages[i]);
  }
  const inscrits = claims.count;
  claims.sort();
  claims.consume(Math.floor(inscrits / 2));
  return claims.count;
}

const options = { chauffe: 1, tours: 5, budgetMs: 300 };

const mesureFentes = await mesure({
  nom: 'réclamations et tri de rangs',
  fichier: 'packages/sdk-browser/webgpuRowClaims.ts',
  cas: [
    { nom: '1 000 réclamations de pages', entree: scenario1000, taille: 1000 },
    { nom: '5 000 réclamations de pages', entree: scenario5000, taille: 5000 },
    { nom: '20 000 réclamations de pages', entree: scenario20000, taille: 20000 },
  ],
  calcul: executeReclamationsEtTri,
  attendu: executeReclamationsEtTri,
  options,
});

rapport(
  'recyclage-fentes',
  mesureFentes,
  'les réclamations et consommations conservent le compte exact de pages restantes',
);
