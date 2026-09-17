// Banc de performance : socle mathématique (sdk-core contre Three.js).
import { rapport } from '../../sdk-core/bench/mesure.mjs';
import { lignesEquivalence, noeudsHierarchie } from './socleEquivalence.mjs';
import { lignesConsommateursCore } from './socleConsommateursCore.mjs';
import { lignesConsommateursBrowser } from './socleConsommateursBrowser.mjs';
import './socleEcarts.mjs';

const lignes = [
  ...(await lignesEquivalence()),
  ...(await lignesConsommateursCore()),
  ...(await lignesConsommateursBrowser()),
];
rapport(
  'socle-math',
  lignes,
  `le socle rend les bits de la référence et du code qu'il remplace (${noeudsHierarchie.length} nœuds hiérarchiques)`,
);
