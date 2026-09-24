// the partition-pass uniform, packed every frame: the two anchored matrices, the
// split-double anchor, and the sixteen Hi-Z pyramid levels, bit-exact against the oracle.
import {
  UNIFORM_U32,
  writeSplitDouble,
} from '../../../packages/sdk-browser/src/gpu/partition/contract.ts';
import { packPartitionUniform } from '../../../packages/sdk-browser/src/gpu/partition/uniform.ts';
import type { PartitionFrame } from '../../../packages/sdk-browser/src/gpu/partition/uniform.ts';
import { graine, mesure, rapport } from '../../core/index.ts';
import {
  referencePartitionUniform,
  referenceSplitDouble,
} from '../../oracles/browser/uniform-partition.ts';

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

// The output belongs to the case: the timer only frames the writes.
const doubles = (valeurs: ArrayLike<number>) => ({
  valeurs,
  output: new Float32Array(valeurs.length * 2),
});
const decompose =
  (ecrit: (out: Float32Array, haut: number, bas: number, value: number) => void) =>
  ({ valeurs, output }: { valeurs: ArrayLike<number>; output: Float32Array }) => {
    for (let i = 0; i < valeurs.length; i++) ecrit(output, i * 2, i * 2 + 1, valeurs[i]);
    return output;
  };

const mesureSplit = await mesure({
  name: 'split-double decomposition',
  fichier: 'packages/sdk-browser/src/gpu/partition/contract.ts',
  cas: [
    {
      name: '50 000 doubles',
      input: doubles(Float64Array.from({ length: 50000 }, double)),
      size: 50000,
    },
    { name: 'hostiles', input: doubles(HOSTILES), size: HOSTILES.length },
  ],
  calcul: decompose(writeSplitDouble),
  attendu: decompose(referenceSplitDouble),
  options: { tours: 100 },
});

const image = (niveaux: number): PartitionFrame => ({
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
  hasRest: true,
  viewMoved: false,
});

const words = new Uint32Array(UNIFORM_U32),
  floats = new Float32Array(words.buffer);

const mesureUniforme = await mesure({
  name: 'partition uniform',
  fichier: 'packages/sdk-browser/src/gpu/partition/uniform.ts',
  cas: [
    { name: '12 Hi-Z levels', input: image(12), size: 1 },
    { name: '0 levels', input: image(0), size: 1 },
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
  'the partition uniform and the doubles yield the same bits',
);
