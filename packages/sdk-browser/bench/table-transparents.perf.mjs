// Banc de performance : tri de l'ordre statique et assemblage de la table des transparents.
import { createTransparentTable } from '../webgpuTransparentTable.ts';
import { graine, mesure, rapport } from '../../sdk-core/bench/mesure.mjs';

function creeSceneTransparente(nbPages) {
  const alea = graine(777);
  const mesh = { name: 'maillage-transparent' };
  const pages = [];
  for (let i = 0; i < nbPages; i++) {
    pages.push({
      id: i,
      sourceOrder: Math.floor(alea() * nbPages),
      transparent: true,
      sourceMesh: mesh,
      triangles: 128,
    });
  }
  const root = { pages };
  const items = [{ sourceMesh: mesh, paged: true }];
  return { roots: [root], packedPages: pages, items, nbPages };
}

const scene500 = creeSceneTransparente(500);
const scene2000 = creeSceneTransparente(2000);
const scene5000 = creeSceneTransparente(5000);

function executeTableTransparents({ roots, packedPages, items }) {
  const table = createTransparentTable(roots, packedPages, items);
  return table.length;
}

const options = { chauffe: 1, tours: 5, budgetMs: 300 };

const mesureTable = await mesure({
  nom: 'assemblage table transparents',
  fichier: 'packages/sdk-browser/webgpuTransparentTable.ts',
  cas: [
    { nom: '500 pages transparentes', entree: scene500, taille: 500 },
    { nom: '2 000 pages transparentes', entree: scene2000, taille: 2000 },
    { nom: '5 000 pages transparentes', entree: scene5000, taille: 5000 },
  ],
  calcul: executeTableTransparents,
  attendu: executeTableTransparents,
  options,
});

rapport(
  'table-transparents',
  mesureTable,
  'la table des transparents alloue une capacité alignée sur les groupes',
);
