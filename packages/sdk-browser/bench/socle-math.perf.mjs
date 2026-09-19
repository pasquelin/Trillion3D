// Performance bench: math foundation (sdk-core against Three.js).
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
  `the foundation yields the bits of the reference and of the code it replaces (${noeudsHierarchie.length} hierarchy nodes)`,
);
