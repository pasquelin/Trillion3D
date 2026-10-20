// the partition-pass uniform, packed every frame: the two anchored matrices, the
// split-double anchor and the scalars, bit-exact against the oracle.
import { PARTITION_UNI } from '../../../packages/sdk-browser/src/gpu/partition/contract.ts'
import { writeSplitDouble } from '../../../packages/math/src/float/splitDouble.ts'
import { packPartitionUniform } from '../../../packages/sdk-browser/src/gpu/partition/uniform.ts'
import type { PartitionFrame } from '../../../packages/sdk-browser/src/gpu/partition/uniform.ts'
import { measure } from '../../core/measure.ts'
import { rapport } from '../../core/report.ts'
import { xorshiftRandom } from '../../../packages/math/src/sequence/random.ts'
import {
  referencePartitionUniform,
  referenceSplitDouble,
} from '../../oracles/browser/uniform-partition.ts'

const alea = xorshiftRandom(89)
const double = () => (alea() - 0.5) * 1e5
const matrice = () => Float64Array.from({ length: 16 }, double)

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
]

// The output belongs to the case: the timer only frames the writes.
const doubles = (valeurs: ArrayLike<number>) => ({
  valeurs,
  output: new Float32Array(valeurs.length * 2),
})
const decompose =
  (ecrit: (out: Float32Array, top: number, bas: number, value: number) => void) =>
  ({ valeurs, output }: { valeurs: ArrayLike<number>; output: Float32Array }) => {
    for (let i = 0; i < valeurs.length; i++) ecrit(output, i * 2, i * 2 + 1, valeurs[i])
    return output
  }

const measureSplit = await measure({
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
  calculation: decompose(writeSplitDouble),
  expected: decompose(referenceSplitDouble),
  options: { tours: 100 },
})

const image = (): PartitionFrame => ({
  view: matrice(),
  viewProj: matrice(),
  anchor: [double(), double(), double()],
  near: 0.1,
  rows: 20000,
  width: 800,
  height: 600,
  layerTop: 0,
  hasRest: true,
  counting: false,
})

const words = new Uint32Array(PARTITION_UNI.words),
  floats = new Float32Array(words.buffer)

const measureUniform = await measure({
  name: 'partition uniform',
  fichier: 'packages/sdk-browser/src/gpu/partition/uniform.ts',
  cas: [{ name: 'one frame', input: image(), size: 1 }],
  calculation: (frame) => {
    packPartitionUniform(words, floats, frame, frame.rows)
    return words
  },
  expected: (frame) => referencePartitionUniform(frame, frame.rows),
  options: { tours: 1000 },
})

rapport(
  'partition-uniforme',
  [measureSplit, measureUniform],
  'the partition uniform and the doubles yield the same bits',
)
