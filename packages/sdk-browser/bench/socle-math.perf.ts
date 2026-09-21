// Performance bench: math foundation (sdk-core against Three.js).
import { rapport } from '../../sdk-core/bench/socle.ts';
import { lignesEquivalence, noeudsHierarchie } from './appui/socleEquivalence.ts';
import { lignesConsommateursCore } from './appui/socleConsommateursCore.ts';
import { lignesConsommateursBrowser } from './appui/socleConsommateursBrowser.ts';
import './appui/socleEcarts.ts';

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
