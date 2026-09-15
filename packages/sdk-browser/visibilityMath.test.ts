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
  // -0 boucle sur elle-même (Repeat) et Infini se pince au bord (ClampToEdge, seul mode où
  // Math.max/Math.min l'absorbent) : deux façons distinctes de garder un index de texel fini.
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
