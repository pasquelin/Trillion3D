// coplanar layer units and the depth bias they apply on a f32.
import { biasedDepthBits, depthLayerUnits } from '../depthLayer.ts';
import { graine, mesure, rapport } from './socle.ts';
import {
  referenceBiasedDepthBits,
  referenceDepthLayerUnits,
} from './oracles/couches-coplanaires.ts';

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
  fichier: 'packages/sdk-core/depthLayer.ts',
  cas: [{ name: '50 000 layers', size: 50000, input: couches(50000) }],
  calcul: unites(depthLayerUnits),
  attendu: unites(referenceDepthLayerUnits),
});

const paires = (nombre: number, fixe?: number) => ({
  bits: Uint32Array.from({ length: nombre }, () => Math.floor(alea() * 0x3f800000)),
  layers: Array.from({ length: nombre }, fixe === undefined ? couche : () => fixe),
  output: new Float64Array(nombre),
});
const biaise =
  (calcule: (bits: number, layer: number | undefined) => number) =>
  ({
    bits,
    layers,
    output,
  }: {
    bits: Uint32Array;
    layers: Couche[];
    output: Float64Array;
  }) => {
    for (let i = 0; i < bits.length; i++)
      output[i] = calcule(bits[i], layers[i] as number | undefined);
    return output;
  };

const mesureBits = await mesure({
  name: 'biased depth bits',
  fichier: 'packages/sdk-core/depthLayer.ts',
  cas: [
    { name: '50 000 pairs', size: 50000, input: paires(50000) },
    { name: 'layer 0', size: 10000, input: paires(10000, 0) },
    {
      name: 'saturated bits',
      size: 2,
      input: {
        bits: Uint32Array.of(0xffffffff, 0x3f800000),
        layers: [3, 15],
        output: new Float64Array(2),
      },
    },
  ],
  calcul: biaise(biasedDepthBits),
  attendu: biaise(referenceBiasedDepthBits),
});

rapport(
  'couches-coplanaires',
  [mesureUnites, mesureBits],
  'layer units and biased bits return the same values',
);
