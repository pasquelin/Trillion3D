// C7 : sRGB vers linéaire dans l'échantillonnage de texture passe d'une puissance par composante et
// par pixel à une table de 256 entrées (visibilityMath.ts). Une composante sRGB 8 bits n'a que 256
// antécédents possibles, donc la table porte exactement les mêmes flottants que la formule d'avant
// le lot C, reproduite ici telle quelle comme oracle explicite. L'égalité attendue est bit à bit
// (`Object.is`), sans tolérance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sampleLinear, sampleMap, wrapTexel } from './visibilityMath.ts';
import { textureRgba } from './visibilityTypes.ts';
import { referenceTextureRgba } from '../../scripts/mesure/calculs/oracles/f-texture.mjs';

/** `visibilityMath.ts` avant le lot C : une puissance par composante, sans table. */
function referenceSrgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function texelIndex(map: THREE.Texture, u: number, v: number) {
  const image = textureRgba(map);
  if (!image) return null;
  const x = wrapTexel(u, image.width, map.wrapS),
    y = wrapTexel(v, image.height, map.wrapT);
  return { data: image.data, i: (y * image.width + x) * 4 };
}

function referenceSampleMap(map: THREE.Texture, u: number, v: number): [number, number, number] {
  const texel = texelIndex(map, u, v);
  if (!texel) return [1, 1, 1];
  const { data: d, i } = texel;
  return [
    referenceSrgbToLinear(d[i] / 255),
    referenceSrgbToLinear(d[i + 1] / 255),
    referenceSrgbToLinear(d[i + 2] / 255),
  ];
}

function texture(width: number, height: number, fill: (i: number) => number, wrap: THREE.Wrapping) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = fill(i);
  const map = new THREE.Texture();
  map.image = { data, width, height };
  map.wrapS = wrap;
  map.wrapT = wrap;
  return map;
}

function bitExact(a: readonly number[], b: readonly number[], message: string) {
  assert.equal(a.length, b.length, message);
  for (let i = 0; i < a.length; i++)
    assert.ok(Object.is(a[i], b[i]), `${message}[${i}]: ${a[i]} ≠ ${b[i]}`);
}

test('les 256 octets sRGB possibles rendent la même valeur linéaire que la formule explicite', () => {
  for (let octet = 0; octet <= 255; octet++) {
    const map = texture(1, 1, () => octet, THREE.ClampToEdgeWrapping);
    bitExact(sampleMap(map, 0, 0), referenceSampleMap(map, 0, 0), `octet ${octet}`);
  }
});

test('les bornes 0 et 255 tombent exactement sur les bornes de la table', () => {
  const noir = texture(1, 1, () => 0, THREE.ClampToEdgeWrapping);
  const blanc = texture(1, 1, () => 255, THREE.ClampToEdgeWrapping);
  assert.deepEqual(sampleMap(noir, 0, 0), [0, 0, 0]);
  bitExact(sampleMap(blanc, 0, 0), [1, 1, 1], 'blanc');
  bitExact(sampleMap(blanc, 0, 0), referenceSampleMap(blanc, 0, 0), 'blanc vs référence');
});

test('une texture sans image rend le blanc des deux côtés, même avec des uv non finis', () => {
  const sansImage = new THREE.Texture();
  for (const [u, v] of [
    [NaN, 0.5],
    [Infinity, -Infinity],
    [-0, 0],
  ] as const) {
    bitExact(sampleMap(sansImage, u, v), referenceSampleMap(sansImage, u, v), `uv ${u},${v}`);
    bitExact(sampleLinear(sansImage, u, v), [1, 1, 1], `sampleLinear uv ${u},${v}`);
  }
});

test('des uv extrêmes ou signés sur une vraie image restent identiques à la formule explicite', () => {
  const map = texture(4, 4, (i) => (i * 17) & 255, THREE.RepeatWrapping);
  const bordee = texture(4, 4, (i) => (i * 53) & 255, THREE.ClampToEdgeWrapping);
  // -0 boucle sur elle-même (Repeat) et Infini se pince au bord (ClampToEdge) : deux façons de
  // garder un index de texel fini.
  for (const [texture_, u, v] of [
    [map, -0, 0],
    [bordee, -1e9, 1e9],
    [bordee, Infinity, -Infinity],
  ] as const) {
    bitExact(
      sampleMap(texture_, u, v),
      referenceSampleMap(texture_, u, v),
      `échantillon uv ${u},${v}`,
    );
  }
});

test('un uv non fini qui rend l’index de texel NaN rend NaN des deux côtés, jamais undefined', () => {
  const map = texture(4, 4, (i) => (i * 17) & 255, THREE.RepeatWrapping);
  const bordee = texture(4, 4, (i) => (i * 53) & 255, THREE.ClampToEdgeWrapping);
  // NaN casse l'index sous n'importe quel enroulement ; Infini/-Infini ne le cassent que sous
  // Repeat (`t - Math.floor(t)` sur un infini vaut NaN), pas sous ClampToEdge (Math.max/Math.min
  // l'absorbent). Les deux côtés doivent rendre NaN, jamais `undefined`.
  for (const [texture_, u, v] of [
    [map, NaN, 0.2],
    [map, Infinity, -Infinity],
    [bordee, NaN, NaN],
  ] as const) {
    const obtenu = sampleMap(texture_, u, v);
    bitExact(obtenu, referenceSampleMap(texture_, u, v), `échantillon uv ${u},${v}`);
    assert.ok(
      obtenu.every((c) => Number.isNaN(c)),
      `échantillon uv ${u},${v} : ${obtenu}`,
    );
  }
});

// Lot F, F15 : `textureRgba` (visibilityTypes.ts) garde les octets d'une texture tant que sa source
// (tampon, décalage, longueur, largeur, hauteur) ne change pas, au lieu d'allouer une vue et un objet
// à chaque texel échantillonné. L'oracle est l'allocation inconditionnelle d'avant le lot F, recopiée
// telle quelle dans `oracles/f-texture.mjs`.
test('une texture sans image ou sans données rend null des deux côtés', () => {
  const sansImage = new THREE.Texture();
  assert.equal(textureRgba(sansImage), referenceTextureRgba(sansImage));
  const largeurNulle = new THREE.Texture();
  largeurNulle.image = { data: new Uint8Array(4), width: 0, height: 1 };
  assert.equal(textureRgba(largeurNulle), referenceTextureRgba(largeurNulle));
});

test('deux appels sur la même image rendent les mêmes octets que la référence, et le même objet mémoïsé', () => {
  const map = texture(2, 2, (i) => i & 255, THREE.ClampToEdgeWrapping);
  const premier = textureRgba(map);
  const second = textureRgba(map);
  assert.equal(second, premier, 'le même objet est réutilisé tant que la source ne change pas');
  const attendu = referenceTextureRgba(map);
  assert.deepEqual(Array.from(premier!.data), Array.from(attendu!.data));
  assert.equal(premier!.width, attendu!.width);
  assert.equal(premier!.height, attendu!.height);
});

test('une image remplacée par un nouveau tampon rend de nouveaux octets, identiques à la référence', () => {
  const map = texture(2, 2, (i) => i & 255, THREE.ClampToEdgeWrapping);
  const premier = textureRgba(map);
  map.image = { data: new Uint8Array(16).fill(7), width: 2, height: 2 };
  const second = textureRgba(map);
  assert.notEqual(second, premier, 'un nouveau tampon source invalide le cache');
  assert.deepEqual(Array.from(second!.data), Array.from(referenceTextureRgba(map)!.data));
});

test('une sous-vue du même tampon (décalage ou longueur différents) n’est jamais confondue avec la vue d’origine', () => {
  const buffer = new Uint8Array(32).map((_, i) => i);
  const map = new THREE.Texture();
  map.image = { data: buffer.subarray(0, 16), width: 2, height: 2 };
  const premier = textureRgba(map);
  map.image = { data: buffer.subarray(4, 20), width: 2, height: 2 }; // même buffer, autre décalage
  const second = textureRgba(map);
  assert.notEqual(second, premier, 'un décalage différent sur le même tampon invalide le cache');
  assert.deepEqual(Array.from(second!.data), Array.from(referenceTextureRgba(map)!.data));
});

test('une même largeur/hauteur mais une image redimensionnée sans changer de tampon invalide aussi le cache', () => {
  const buffer = new Uint8Array(64).fill(9);
  const map = new THREE.Texture();
  map.image = { data: buffer, width: 4, height: 4 };
  const premier = textureRgba(map);
  map.image = { data: buffer, width: 8, height: 2 }; // même tampon, dimensions différentes
  const second = textureRgba(map);
  assert.notEqual(second, premier);
  assert.deepEqual(second, referenceTextureRgba(map));
});
