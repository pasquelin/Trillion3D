// coplanar layer units against their oracle.
import { depthLayerUnits } from '../../../packages/sdk-core/src/lod/depthLayer.ts';
import { graine, mesure, rapport } from '../../core/index.ts';
import { referenceDepthLayerUnits } from '../../oracles/core/coplanar-layers.ts';

const alea = graine(107);

/** A hostile layer: out of bounds, non-finite, or missing (`null` behaves as `undefined` on the
 *  engine's `!layer` guard — this bench deliberately probes that wider, unsigned contract). */
type Couche = number | undefined | null;

// One third of the layers are hostile: out of bounds, non-finite, or missing. The engine brings them
// all to zero without throwing, and this is what the oracle checks on both functions.
const HOSTILES: Couche[] = [-1, 16, NaN, Infinity, -Infinity, undefined, null];
const couche = (): Couche =>
  alea() < 0.3 ? HOSTILES[Math.floor(alea() * HOSTILES.length)] : Math.floor(alea() * 16);

// Output belongs to the test case: the timer only measures engine calls.
const couches = (nombre: number) => ({
  liste: Array.from({ length: nombre }, couche),
  output: new Float64Array(nombre),
});
const unites =
  (calcule: (layer: number | undefined) => number) =>
  ({ liste, output }: { liste: Couche[]; output: Float64Array }) => {
    for (let i = 0; i < liste.length; i++) output[i] = calcule(liste[i] as number | undefined);
    return output;
  };

const mesureUnites = await mesure({
  name: 'coplanar layer units',
  fichier: 'packages/sdk-core/src/lod/depthLayer.ts',
  cas: [{ name: '50 000 layers', size: 50000, input: couches(50000) }],
  calcul: unites(depthLayerUnits),
  attendu: unites(referenceDepthLayerUnits),
});

rapport('couches-coplanaires', [mesureUnites], 'layer units return the same values');
