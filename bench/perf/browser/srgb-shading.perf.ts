// sRGB to linear in texture sampling.
import type { Texture } from '../../../packages/sdk-core/src/index.ts';
import { importHostTexture } from '../../../packages/sdk-browser/src/host/textureImport.ts';
import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import {
  sampleLinear,
  sampleMap,
  wrapTexel,
} from '../../../packages/sdk-browser/src/visibility/math.ts';
import { textureRgba } from '../../../packages/sdk-browser/src/visibility/types.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';

function referenceSrgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function referenceSampleTexel(
  map: Texture,
  u: number,
  v: number,
): [number, number, number, number] | null {
  const image = textureRgba(map);
  if (!image) return null;
  const x = wrapTexel(u, image.width, map.wrapS),
    y = wrapTexel(v, image.height, map.wrapT),
    i = (y * image.width + x) * 4,
    d = image.data;
  return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, d[i + 3] / 255];
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
) {
  const alea = graine(seed),
    data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++)
    data[i] = i < 1024 ? i & 255 : Math.floor(alea() * 256) & 255;
  const map = new G.GraphTexture();
  map.image = { data, width, height };
  map.wrapS = wrapS;
  map.wrapT = wrapT;
  return importHostTexture(map);
}

const sansImage = importHostTexture(new G.GraphTexture());
const atlas = texture(256, 256, 17, G.HOST_WRAP_REPEAT, G.HOST_WRAP_REPEAT);

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
  { name: 'no image', input: { map: sansImage, coords: points.slice(0, 10) }, size: 10 },
];

const resSrgb = await mesure({
  name: 'sRGB to linear',
  fichier: 'packages/sdk-browser/src/visibility/math.ts',
  cas,
  calcul: parcours(sampleMap),
  attendu: parcours(referenceSampleMap),
  options: { tours: 60, budgetMs: 1500 },
});

const resLinear = await mesure({
  name: 'linear sampling',
  fichier: 'packages/sdk-browser/src/visibility/math.ts',
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
