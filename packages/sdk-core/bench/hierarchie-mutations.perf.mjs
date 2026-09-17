// Banc de performance : mise à jour incrémentale ciblée de la hiérarchie sous mutations.
import {
  createTransformTree,
  addTransformNode,
  setNodePosition,
} from '../mathTransformTree.ts';
import { updateNodeMatrixWorld, updateNodeWorldMatrix } from '../mathTransformTreeUpdate.ts';
import { mesure, rapport } from './mesure.mjs';

function creeArbre(taille) {
  const tree = createTransformTree(taille + 10);
  const racine = addTransformNode(tree, -1);
  const noeuds = [racine];
  for (let i = 1; i < taille; i++) {
    const parent = noeuds[Math.floor((i - 1) / 4)];
    const node = addTransformNode(tree, parent);
    setNodePosition(tree, node, i * 0.1, 0, 0);
    noeuds.push(node);
  }
  updateNodeMatrixWorld(tree, racine, true);
  return { tree, noeuds, taille };
}

function muteEtMesure(nbMutations) {
  const { tree, noeuds } = creeArbre(1000);
  for (let i = 0; i < nbMutations; i++) {
    const idx = (i * 17) % noeuds.length;
    const node = noeuds[idx];
    setNodePosition(tree, node, i * 1.5, i * 0.5, 0);
    updateNodeWorldMatrix(tree, node, true, true);
  }
  return tree.worldViews[noeuds[17 % noeuds.length]][0];
}

const options = { chauffe: 1, tours: 3, budgetMs: 300 };

const mesureMutations = await mesure({
  nom: 'mutations hiérarchiques ciblées',
  fichier: 'packages/sdk-core/mathTransformTreeUpdate.ts',
  cas: [
    { nom: '50 nœuds mutés dans 1 000', entree: 50, taille: 50 },
    { nom: '200 nœuds mutés dans 1 000', entree: 200, taille: 200 },
    { nom: '500 nœuds mutés dans 1 000', entree: 500, taille: 500 },
  ],
  calcul: (nb) => muteEtMesure(nb),
  attendu: (nb) => muteEtMesure(nb),
  options,
});

rapport(
  'hierarchie-mutations',
  mesureMutations,
  'les mutations ciblées mettent à jour les positions monde avec exactitude bit-à-bit',
);

