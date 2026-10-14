// coplanar layer units against their golden.
import { depthLayerUnits } from '../../../packages/sdk-core/src/lod/depthLayer.ts'
import { measure } from '../../core/measure.ts'
import { rapport } from '../../core/report.ts'
import { xorshiftRandom } from '../../../packages/math/src/sequence/random.ts'

const alea = xorshiftRandom(107)

/** A hostile layer: out of bounds, non-finite, or missing (`null` behaves as `undefined` on the
 *  engine's `!layer` guard — this bench deliberately probes that wider, unsigned contract). */
type Couche = number | undefined | null

// One third of the layers are hostile: out of bounds, non-finite, or missing. The engine brings them
// all to zero without throwing, and this is what the oracle checks on both functions.
const HOSTILES: Couche[] = [-1, 16, NaN, Infinity, -Infinity, undefined, null]
/** The units of every layer the bench draws, frozen from the engine's contract: a layer's floor
 *  times 16 units, capped at layer 15; a hostile layer, none. */
const GOLDEN_UNITS = new Map<Couche, number>([
  ...Array.from({ length: 16 }, (_, layer): [Couche, number] => [layer, layer * 16]),
  [-1, 0],
  [16, 240],
  [NaN, 0],
  [Infinity, 0],
  [-Infinity, 0],
  [undefined, 0],
  [null, 0],
])
const couche = (): Couche =>
  alea() < 0.3 ? HOSTILES[Math.floor(alea() * HOSTILES.length)] : Math.floor(alea() * 16)

// Output belongs to the test case: the timer only measures engine calls.
const couches = (count: number) => ({
  list: Array.from({ length: count }, couche),
  output: new Float64Array(count),
})
const unites =
  (calcule: (layer: number | undefined) => number) =>
  ({ list, output }: { list: Couche[]; output: Float64Array }) => {
    for (let i = 0; i < list.length; i++) output[i] = calcule(list[i] as number | undefined)
    return output
  }

const measureUnits = await measure({
  name: 'coplanar layer units',
  fichier: 'packages/sdk-core/src/lod/depthLayer.ts',
  cas: [{ name: '50 000 layers', size: 50000, input: couches(50000) }],
  calculation: unites(depthLayerUnits),
  expected: unites((layer) => GOLDEN_UNITS.get(layer)!),
})

rapport('couches-coplanaires', [measureUnits], 'layer units return the same values')
