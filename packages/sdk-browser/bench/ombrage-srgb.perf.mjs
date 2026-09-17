// sRGB vers linéaire dans l'échantillonnage de texture.
import * as THREE from 'three';
import { sampleLinear, sampleMap, wrapTexel } from '../visibilityMath.ts';
import { textureRgba } from '../visibilityTypes.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';

function referenceSrgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function referenceSampleTexel(map, u, v) {
  const image = textureRgba(map);
  if (!image) return null;
  const x = wrapTexel(u, image.width, map.wrapS),
    y = wrapTexel(v, image.height, map.wrapT),
    i = (y * image.width + x) * 4,
    d = image.data;
  return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, d[i + 3] / 255];
}
function referenceSampleMap(map, u, v) {
  const texel = referenceSampleTexel(map, u, v);
  if (!texel) return [1, 1, 1];
  return [
    referenceSrgbToLinear(texel[0]),
    referenceSrgbToLinear(texel[1]),
    referenceSrgbToLinear(texel[2]),
  ];
}
function referenceSampleLinear(map, u, v) {
  const texel = referenceSampleTexel(map, u, v);
  if (!texel) return [1, 1, 1];
  return [texel[0], texel[1], texel[2]];
}

function texture(width, height, seed, wrapS, wrapT) {
  const alea = graine(seed),
    data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++)
    data[i] = i < 1024 ? i & 255 : Math.floor(alea() * 256) & 255;
  const map = new THREE.Texture();
  map.image = { data, width, height };
  map.wrapS = wrapS;
  map.wrapT = wrapT;
  return map;
}

const sansImage = new THREE.Texture();
const atlas = texture(256, 256, 17, THREE.RepeatWrapping, THREE.RepeatWrapping);

function parcours(sampler) {
  return (entree) => {
    const { map, coords } = entree;
    const sortie = new Float64Array(coords.length * 3);
    for (let i = 0; i < coords.length; i++) {
      const c = sampler(map, coords[i][0], coords[i][1]);
      sortie[i * 3] = c[0];
      sortie[i * 3 + 1] = c[1];
      sortie[i * 3 + 2] = c[2];
    }
    return sortie;
  };
}

const alea = graine(31);
const points = [];
for (let i = 0; i < 4000; i++) points.push([alea() * 4 - 2, alea() * 4 - 2]);

const cas = [
  { nom: '4 000 échantillons sRGB', entree: { map: atlas, coords: points }, taille: 4000 },
  { nom: 'sans image', entree: { map: sansImage, coords: points.slice(0, 10) }, taille: 10 },
];

const resSrgb = await mesure({
  nom: 'sRGB vers linéaire',
  fichier: 'packages/sdk-browser/visibilityMath.ts',
  cas,
  calcul: parcours(sampleMap),
  attendu: parcours(referenceSampleMap),
  options: { tours: 60, budgetMs: 1500 },
});

const resLinear = await mesure({
  nom: 'échantillonnage linéaire',
  fichier: 'packages/sdk-browser/visibilityMath.ts',
  cas,
  calcul: parcours(sampleLinear),
  attendu: parcours(referenceSampleLinear),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  nom: 'sampleMap extremes',
  calcul: ([u, v]) => sampleMap(atlas, u, v),
  extremes: [
    { nom: 'NaN', entree: [NaN, NaN] },
    { nom: 'infini', entree: [Infinity, -Infinity] },
    { nom: 'zero', entree: [0, 0] },
  ],
});

rapport('ombrage-srgb', [resSrgb, resLinear], 'C7 rend exactement les mêmes composantes');
