// sRGB to linear in texture sampling.
import type { Texture } from '../../../packages/sdk-core/src/index.ts';
import { importHostTexture } from '../../../packages/sdk-browser/src/host/textureImport.ts';
import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { wrapTexel } from '../../../packages/sdk-browser/src/visibility/math.ts';
import { sampleLinear, sampleMap } from '../../oracles/browser/cpu-image/math.ts';
import { textureRgba } from '../../../packages/sdk-browser/src/visibility/types.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';

function referenceSrgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * The texel's components as both GPU paths upload them (0ff85929e9, 5c6c43e0bc): the coordinate
 * through the map's affine UV transform unless it is the identity, a `flipY` map's rows read from
 * the last, and each colour byte times its alpha byte, rounded, under `premultiplyAlpha`.
 */
function referenceSampleTexel(
  map: Texture,
  u: number,
  v: number,
): [number, number, number, number] | null {
  const image = textureRgba(map);
  if (!image) return null;
  const m = map.transform,
    identity = m[0] === 1 && m[1] === 0 && m[3] === 0 && m[4] === 1 && m[6] === 0 && m[7] === 0,
    tu = identity ? u : m[0] * u + m[3] * v + m[6],
    tv = identity ? v : m[1] * u + m[4] * v + m[7];
  const x = wrapTexel(tu, image.width, map.wrapS),
    row = wrapTexel(tv, image.height, map.wrapT),
    y = map.flipY ? image.height - 1 - row : row,
    i = (y * image.width + x) * 4,
    d = image.data,
    alpha = map.premultiplyAlpha ? d[i + 3] : 255,
    byte = (k: number) => Math.round((d[i + k] * alpha) / 255) / 255;
  return [byte(0), byte(1), byte(2), d[i + 3] / 255];
}
function referenceSampleMap(map: Texture, u: number, v: number): [number, number, number] {
  const texel = referenceSampleTexel(map, u, v);
  if (!texel) return [1, 1, 1];
  return [
    referenceSrgbToLinear(texel[0]),
    referenceSrgbToLinear(texel[1]),
    referenceSrgbToLinear(texel[2]),
  ];
}
function referenceSampleLinear(map: Texture, u: number, v: number): [number, number, number] {
  const texel = referenceSampleTexel(map, u, v);
  if (!texel) return [1, 1, 1];
  return [texel[0], texel[1], texel[2]];
}

function texture(
  width: number,
  height: number,
  seed: number,
  wrapS: THREE.Wrapping,
  wrapT: THREE.Wrapping,
  dressed = false,
) {
  const alea = graine(seed),
    data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++)
    data[i] = i < 1024 ? i & 255 : Math.floor(alea() * 256) & 255;
  const map = new G.GraphTexture();
  map.image = { data, width, height };
  map.wrapS = wrapS;
  map.wrapT = wrapT;
  // A dressed map: premultiplied, rows unflipped, a turned and stretched UV transform.
  if (dressed) {
    Object.assign(map, { premultiplyAlpha: true, flipY: false, rotation: 0.3 });
    map.offset.set(0.25, -0.5);
    map.repeat.set(2, 3);
    map.updateMatrix();
  }
  return importHostTexture(map);
}

const sansImage = importHostTexture(new G.GraphTexture());
const atlas = texture(256, 256, 17, G.HOST_WRAP_REPEAT, G.HOST_WRAP_REPEAT);
const habille = texture(256, 128, 23, G.HOST_WRAP_MIRRORED_REPEAT, G.HOST_WRAP_REPEAT, true);

type EchantillonneurTexel = (map: Texture, u: number, v: number) => readonly number[];

function parcours(sampler: EchantillonneurTexel) {
  return (input: { map: Texture; coords: readonly (readonly [number, number])[] }) => {
    const { map, coords } = input;
    const output = new Float64Array(coords.length * 3);
    for (let i = 0; i < coords.length; i++) {
      const c = sampler(map, coords[i][0], coords[i][1]);
      output[i * 3] = c[0];
      output[i * 3 + 1] = c[1];
      output[i * 3 + 2] = c[2];
    }
    return output;
  };
}

const alea = graine(31);
const points: [number, number][] = [];
for (let i = 0; i < 4000; i++) points.push([alea() * 4 - 2, alea() * 4 - 2]);

const cas = [
  { name: '4 000 sRGB samples', input: { map: atlas, coords: points }, size: 4000 },
  {
    name: '4 000 samples, premultiplied, transformed, unflipped',
    input: { map: habille, coords: points },
    size: 4000,
  },
  { name: 'no image', input: { map: sansImage, coords: points.slice(0, 10) }, size: 10 },
];

const resSrgb = await mesure({
  name: 'sRGB to linear',
  fichier: 'bench/oracles/browser/cpu-image/math.ts',
  cas,
  calcul: parcours(sampleMap),
  attendu: parcours(referenceSampleMap),
  options: { tours: 60, budgetMs: 1500 },
});

const resLinear = await mesure({
  name: 'linear sampling',
  fichier: 'bench/oracles/browser/cpu-image/math.ts',
  cas,
  calcul: parcours(sampleLinear),
  attendu: parcours(referenceSampleLinear),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  name: 'sampleMap extremes',
  calcul: ([u, v]) => sampleMap(atlas, u, v),
  extremes: [
    { name: 'NaN', input: [NaN, NaN] },
    { name: 'infinity', input: [Infinity, -Infinity] },
    { name: 'zero', input: [0, 0] },
  ],
});

rapport('ombrage-srgb', [resSrgb, resLinear], 'C7 yields the exact same components');
