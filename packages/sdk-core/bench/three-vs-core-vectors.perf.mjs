// Three.js vs sdk-core, vectors and colours: point transform, cross and dot products, length,
// scaling, sRGB decoding and HSL. Three writes its own vectors, the engine writes one buffer at
// an offset — the form its offsets exist for — and Three's vectors are read flat untimed.
import * as THREE from 'three';
import {
  copyScaledVector3,
  crossVector3,
  dotVector3,
  lengthSqVector3,
  transformAffinePoint,
} from '../mathVector.ts';
import { hslToLinearRgb, srgbToLinear } from '../mathColor.ts';
import { rapport } from './socle.mjs';
import {
  N,
  SRGB_REFERENCE_GAP,
  alea,
  duel,
  flatOf,
  points,
  trsMatrices,
} from './oracles/three-duel.mjs';

const VECTORS = 'packages/sdk-core/mathVector.ts';
const m = trsMatrices(N);
const u = points(N),
  v = points(N);
const out = new Float64Array(N * 3),
  outThree = Array.from({ length: N }, () => new THREE.Vector3()),
  outFlatThree = new Float64Array(N * 3);
const oracle = () => flatOf(outThree, 3, outFlatThree);
const scalar = new Float64Array(N),
  scalarThree = new Float64Array(N);

const lines = [];
lines.push(
  await duel({
    nom: 'Vector3.applyMatrix4',
    fichier: VECTORS,
    three: () => {
      for (let i = 0; i < N; i++) outThree[i].copy(u.three[i]).applyMatrix4(m.three[i]);
    },
    oracle,
    core: () => {
      const f = u.flat;
      for (let i = 0; i < N; i++)
        transformAffinePoint(out, m.views[i], f[i * 3], f[i * 3 + 1], f[i * 3 + 2], i * 3);
      return out;
    },
  }),
);

lines.push(
  await duel({
    nom: 'Vector3.crossVectors',
    fichier: VECTORS,
    three: () => {
      for (let i = 0; i < N; i++) outThree[i].crossVectors(u.three[i], v.three[i]);
    },
    oracle,
    core: () => {
      for (let i = 0; i < N; i++) crossVector3(out, u.flat, v.flat, i * 3, i * 3, i * 3);
      return out;
    },
  }),
);

lines.push(
  await duel({
    nom: 'Vector3.dot',
    fichier: VECTORS,
    three: () => {
      for (let i = 0; i < N; i++) scalarThree[i] = u.three[i].dot(v.three[i]);
    },
    oracle: () => scalarThree,
    core: () => {
      for (let i = 0; i < N; i++) scalar[i] = dotVector3(u.flat, v.flat, i * 3, i * 3);
      return scalar;
    },
  }),
);

lines.push(
  await duel({
    nom: 'Vector3.length',
    fichier: VECTORS,
    three: () => {
      for (let i = 0; i < N; i++) scalarThree[i] = u.three[i].length();
    },
    oracle: () => scalarThree,
    core: () => {
      for (let i = 0; i < N; i++) scalar[i] = Math.sqrt(lengthSqVector3(u.flat, i * 3));
      return scalar;
    },
  }),
);

lines.push(
  await duel({
    nom: 'Vector3.multiplyScalar',
    fichier: VECTORS,
    three: () => {
      for (let i = 0; i < N; i++) outThree[i].copy(u.three[i]).multiplyScalar(1.5);
    },
    oracle,
    core: () => {
      for (let i = 0; i < N; i++) copyScaledVector3(out, u.flat, 1.5, i * 3, i * 3);
      return out;
    },
  }),
);

// Colours: three seeded channels per element, decoded or built on both sides, three stores each.
const COLOR = 'packages/sdk-core/mathColor.ts';
const channel = Float64Array.from({ length: N * 3 }, () => alea());
const color = new THREE.Color();
const colorsThree = new Float64Array(N * 3);
const storeColor = (i) => {
  colorsThree[i * 3] = color.r;
  colorsThree[i * 3 + 1] = color.g;
  colorsThree[i * 3 + 2] = color.b;
};

lines.push(
  await duel({
    nom: 'Color.convertSRGBToLinear',
    fichier: COLOR,
    three: () => {
      for (let i = 0; i < N; i++) {
        const at = i * 3;
        color.setRGB(channel[at], channel[at + 1], channel[at + 2], THREE.LinearSRGBColorSpace);
        color.convertSRGBToLinear();
        storeColor(i);
      }
    },
    oracle: () => colorsThree,
    core: () => {
      for (let i = 0; i < N * 3; i++) out[i] = srgbToLinear(channel[i]);
      return out;
    },
    tolerance: SRGB_REFERENCE_GAP,
    motif: 'Three multiplies by rounded constants, the engine divides',
  }),
);

lines.push(
  await duel({
    nom: 'Color.setHSL',
    fichier: COLOR,
    three: () => {
      for (let i = 0; i < N; i++) {
        const at = i * 3;
        color.setHSL(channel[at], channel[at + 1], channel[at + 2]);
        storeColor(i);
      }
    },
    oracle: () => colorsThree,
    core: () => {
      for (let i = 0; i < N; i++) {
        const at = i * 3;
        hslToLinearRgb(out, at, channel[at], channel[at + 1], channel[at + 2]);
      }
      return out;
    },
  }),
);

rapport(
  'three-vs-core-vectors',
  lines,
  'sdk-core vectors and colours give the same bits as Three.js, at least as fast',
);
