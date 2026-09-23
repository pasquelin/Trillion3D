// Performance bench: math foundation (sdk-core against Three.js).
import { rapport } from '../../core/index.ts';
import { lignesEquivalence, noeudsHierarchie } from './support/socleEquivalence.ts';
import { lignesConsommateursCore } from './support/socleConsommateursCore.ts';
import { lignesConsommateursBrowser } from './support/socleConsommateursBrowser.ts';
import './support/socleEcarts.ts';

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
