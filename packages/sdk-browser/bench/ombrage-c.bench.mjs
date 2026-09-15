// C7 : sRGB vers linéaire dans l'échantillonnage de texture. Référence = `visibilityMath.ts:96-126`
// d'avant le lot C, recopié tel quel : une puissance par composante et par pixel, sur un texel
// d'abord recopié en quatre flottants. L'optimisée lit l'octet et va chercher la valeur dans une
// table de 256 entrées — une composante sRGB 8 bits n'a pas d'autre antécédent que celui-là, donc
// la table porte exactement les mêmes flottants. L'égalité attendue est bit à bit, sans tolérance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sampleLinear, sampleMap, wrapTexel } from '../visibilityMath.ts';
import { textureRgba } from '../visibilityTypes.ts';
import { compareC, deposeC } from './bancC.mjs';
import { graine } from '../../sdk-core/bench/banc.mjs';

/** `visibilityMath.ts:96-98` avant le lot C. */
function referenceSrgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** `visibilityMath.ts:104-116` avant le lot C : le texel recopié en quatre flottants. */
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

/** Une texture dont les 256 octets possibles apparaissent tous, plus du bruit à graine fixe. */
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

/** Une texture sans image : `textureRgba` rend `null`, les deux côtés doivent rendre le blanc. */
const sansImage = new THREE.Texture();

const atlas = texture(256, 256, 17, THREE.RepeatWrapping, THREE.RepeatWrapping);
const borde = texture(64, 64, 29, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping);

/** Les coordonnées que traverse un pixel d'ombrage : dans la dalle, hors dalle, et non finies. */
function coordonnees(count, seed) {
  const alea = graine(seed),
    uv = new Float64Array(count * 2);
  const mauvais = [NaN, Infinity, -Infinity, -0, 1, 0, -1e9, 1e9];
  for (let i = 0; i < count; i++) {
    if (i % 257 === 0) {
      uv[i * 2] = mauvais[i % mauvais.length];
      uv[i * 2 + 1] = mauvais[(i + 3) % mauvais.length];
      continue;
    }
    uv[i * 2] = (alea() - 0.5) * 3;
    uv[i * 2 + 1] = (alea() - 0.5) * 3;
  }
  return uv;
}

const pixels = { uv: coordonnees(200000, 5), maps: [atlas, borde, sansImage] };
const rares = { uv: coordonnees(64, 91), maps: [borde, atlas] };
// uv qui rendent l'index de texel NaN : sous Repeat, NaN et Infini le cassent (`t - Math.floor(t)`
// sur un infini vaut NaN) ; sous ClampToEdge seul NaN le casse (Math.max/Math.min absorbent Infini).
// Nommés explicitement plutôt que confiés au hasard de `coordonnees`, pour que « Identique » les
// couvre à coup sûr — ni mesurés en temps, ni de taille comparable aux cas ci-dessus.
const indexRompu = {
  uv: Float64Array.from([NaN, 0.2, Infinity, -Infinity, NaN, NaN, -0, 0]),
  maps: [atlas, atlas, borde, atlas],
};

/** Une image d'ombrage : chaque coordonnée échantillonnée en couleur puis en linéaire. Un tableau
 *  ordinaire, jamais un `Float64Array` : celui-ci convertirait un `undefined` en `NaN` à l'écriture
 *  et masquerait la différence que la comparaison doit justement voir. */
const passe = (map, linear) => (entree) => {
  const { uv, maps } = entree,
    sortie = new Array(uv.length * 3);
  for (let i = 0; i < uv.length / 2; i++) {
    const texture = maps[i % maps.length],
      u = uv[i * 2],
      v = uv[i * 2 + 1];
    const couleur = map(texture, u, v),
      brut = linear(texture, u, v);
    const at = i * 6;
    sortie[at] = couleur[0];
    sortie[at + 1] = couleur[1];
    sortie[at + 2] = couleur[2];
    sortie[at + 3] = brut[0];
    sortie[at + 4] = brut[1];
    sortie[at + 5] = brut[2];
  }
  return sortie;
};

const lignes = [
  await compareC({
    calcul: 'C7 sRGB vers linéaire',
    fichier: 'packages/sdk-browser/visibilityMath.ts',
    cas: [
      { nom: '200 000 texels, trois textures, uv non finis', entree: pixels, taille: 200000 },
      { nom: '64 texels, deux textures', entree: rares, taille: 64 },
      {
        nom: '4 texels, index de texel rendu NaN par uv',
        entree: indexRompu,
        taille: 4,
        mesure: false,
      },
    ],
    reference: passe(referenceSampleMap, referenceSampleLinear),
    optimisee: passe(sampleMap, sampleLinear),
    options: { chauffe: 4, tours: 40, budgetMs: 3000 },
  }),
];

test('C7 a été mesuré et son écart est décrit', () => {
  for (const ligne of lignes) {
    assert.ok(ligne.avantMs > 0, `${ligne.calcul} : aucune mesure`);
    assert.ok(ligne.identique || ligne.ecart, `${ligne.calcul} : écart non décrit`);
  }
});
deposeC('ombrage-c', lignes);
