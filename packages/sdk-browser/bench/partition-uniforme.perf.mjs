// l'uniforme de la passe de partition, empaqueté à chaque image : les deux matrices ancrées,
// l'ancre en double flottant et les seize niveaux de la pyramide Hi-Z, bit à bit contre l'oracle.
import { UNIFORM_U32, writeSplitDouble } from '../gpuPartitionContract.ts';
import { packPartitionUniform } from '../gpuPartitionUniform.ts';
import { graine, mesure, rapport } from '../../sdk-core/bench/socle.mjs';
import { referencePartitionUniform, referenceSplitDouble } from './oracles/partition-uniforme.mjs';

const alea = graine(89);
const double = () => (alea() - 0.5) * 1e5;
const matrice = () => Float64Array.from({ length: 16 }, double);

const HOSTILES = [
  0,
  -0,
  NaN,
  Infinity,
  -Infinity,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  1e15,
  -1e15,
  2 ** -1022,
  2 ** 1023,
  1.0000000000000002,
  1 / 3,
];

// La sortie appartient au cas : le chronomètre n'encadre que les écritures.
const doubles = (valeurs) => ({ valeurs, sortie: new Float32Array(valeurs.length * 2) });
const decompose =
  (ecrit) =>
  ({ valeurs, sortie }) => {
    for (let i = 0; i < valeurs.length; i++) ecrit(sortie, i * 2, i * 2 + 1, valeurs[i]);
    return sortie;
  };

const mesureSplit = await mesure({
  nom: 'décomposition split-double',
  fichier: 'packages/sdk-browser/gpuPartitionContract.ts',
  cas: [
    {
      nom: '50 000 doubles',
      entree: doubles(Float64Array.from({ length: 50000 }, double)),
      taille: 50000,
    },
    { nom: 'hostiles', entree: doubles(HOSTILES), taille: HOSTILES.length },
  ],
  calcul: decompose(writeSplitDouble),
  attendu: decompose(referenceSplitDouble),
  options: { tours: 100 },
});

const image = (niveaux) => ({
  view: matrice(),
  viewProj: matrice(),
  anchor: [double(), double(), double()],
  near: 0.1,
  rows: 20000,
  width: 800,
  height: 600,
  levels: Array.from({ length: niveaux }, (_, i) => ({
    offset: i * 1024,
    width: Math.max(1, Math.floor(alea() * 1024)),
  })),
  layerTop: 0,
  historyValid: true,
  hasRest: false,
});

const words = new Uint32Array(UNIFORM_U32),
  floats = new Float32Array(words.buffer);

const mesureUniforme = await mesure({
  nom: 'uniforme de partition',
  fichier: 'packages/sdk-browser/gpuPartitionUniform.ts',
  cas: [
    { nom: '12 niveaux Hi-Z', entree: image(12), taille: 1 },
    { nom: '0 niveau', entree: image(0), taille: 1 },
  ],
  calcul: (frame) => {
    packPartitionUniform(words, floats, frame, frame.rows);
    return words;
  },
  attendu: (frame) => referencePartitionUniform(frame, frame.rows),
  options: { tours: 1000 },
});

rapport(
  'partition-uniforme',
  [mesureSplit, mesureUniforme],
  "l'uniforme de partition et les doubles rendent les mêmes bits",
);
