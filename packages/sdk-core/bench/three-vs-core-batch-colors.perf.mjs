// Colour batches compare the same N RGB colours, i.e. 3N scalar channels, in both directions.
import * as THREE from 'three';
import { linearToSrgbBatch, srgbToLinearBatch } from '../mathIndex.ts';
import { rapport } from './socle.mjs';
import {
  N,
  SRGB_REFERENCE_GAP,
  LINEAR_SRGB_REFERENCE_GAP,
  alea,
  duel,
} from './oracles/three-duel.mjs';

const channels = N * 3;
const input = new Float64Array(channels),
  out = new Float64Array(channels);
const reference = new Float64Array(channels);
const colors = Array.from({ length: N }, (_, i) => {
  const c = new THREE.Color();
  c.r = input[i * 3] = alea();
  c.g = input[i * 3 + 1] = alea();
  c.b = input[i * 3 + 2] = alea();
  return c;
});
const outputColors = Array.from({ length: N }, () => new THREE.Color());
const oracle = () => {
  for (let i = 0; i < N; i++) outputColors[i].toArray(reference, i * 3);
  return reference;
};
const lines = [];
lines.push(
  await duel({
    name: 'Color.convertSRGBToLinear batch',
    fichier: 'packages/sdk-core/mathBatchColor.ts',
    three: () => {
      for (let i = 0; i < N; i++) outputColors[i].copy(colors[i]).convertSRGBToLinear();
    },
    oracle,
    core: () => {
      srgbToLinearBatch(out, input, channels);
      return out;
    },
    tolerance: SRGB_REFERENCE_GAP,
    slower: {
      atMost: 1.1,
      reason: 'exact sRGB divisions shared with WGSL, versus rounded reference multipliers',
    },
    motif: '200000 RGB colours; Three rounds the sRGB constants',
  }),
);
lines.push(
  await duel({
    name: 'Color.convertLinearToSRGB batch',
    fichier: 'packages/sdk-core/mathBatchColor.ts',
    three: () => {
      for (let i = 0; i < N; i++) outputColors[i].copy(colors[i]).convertLinearToSRGB();
    },
    oracle,
    core: () => {
      linearToSrgbBatch(out, input, channels);
      return out;
    },
    tolerance: LINEAR_SRGB_REFERENCE_GAP,
    slower: {
      atMost: 1.1,
      reason: 'exact exponent 1 / 2.4 and negative guard, versus rounded exponent 0.41666',
    },
    motif: '200000 RGB colours; Three rounds exponent 1 / 2.4 to 0.41666',
  }),
);
rapport(
  'three-vs-core-batch-colors',
  lines,
  'RGB batch conversions: all channels timed and compared',
);
