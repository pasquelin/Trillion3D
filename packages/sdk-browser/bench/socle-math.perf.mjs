// Banc de performance : socle mathématique (sdk-core contre Three.js).
import { rapport } from '../../sdk-core/bench/socle.mjs';
import { lignesEquivalence, noeudsHierarchie } from './appui/socleEquivalence.mjs';
import { lignesConsommateursCore } from './appui/socleConsommateursCore.mjs';
import { lignesConsommateursBrowser } from './appui/socleConsommateursBrowser.mjs';
import './appui/socleEcarts.mjs';

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
