// Performance bench: math foundation (sdk-core against Three.js).
import { rapport } from '../../core/index.ts';
import { lignesEquivalence, hierarchyNodes } from './support/coreEquivalence.ts';
import { lignesConsommateursBrowser } from './support/coreConsumersBrowser.ts';
import './support/coreDiffs.ts';

const lignes = [...(await lignesEquivalence()), ...(await lignesConsommateursBrowser())];
rapport(
  'socle-math',
  lignes,
  `the foundation yields the bits of the reference and of the code it replaces (${hierarchyNodes.length} hierarchy nodes)`,
);
