// C7: sRGB to linear in texture sampling moves from a per-component, per-pixel power to a
// 256-entry table (visibilityMath.ts). An 8-bit sRGB component has only 256 possible antecedents,
// so the table carries exactly the same floats as the pre-lot-C formula, reproduced here as-is as
// an explicit oracle. The expected equality is bit-exact (`Object.is`), with no tolerance.
import type { Texture } from '../sdk-core/index.ts';
import { importHostTexture } from './hostSurfaceImport.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sampleLinear, sampleMap, wrapTexel } from './visibilityMath.ts';
import { textureRgba } from './visibilityTypes.ts';
import { referenceTextureRgba } from '../../bench/oracles/browser/texture-echantillonnee.ts';

/** `visibilityMath.ts` before lot C: a power per component, without a table. */
function referenceSrgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function texelIndex(map: Texture, u: number, v: number) {
  const image = textureRgba(map);
  if (!image) return null;
  const x = wrapTexel(u, image.width, map.wrapS),
    y = wrapTexel(v, image.height, map.wrapT);
  return { data: image.data, i: (y * image.width + x) * 4 };
}

function referenceSampleMap(map: Texture, u: number, v: number): [number, number, number] {
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
  return importHostTexture(map);
}

function bitExact(a: readonly number[], b: readonly number[], message: string) {
  assert.equal(a.length, b.length, message);
  for (let i = 0; i < a.length; i++)
    assert.ok(Object.is(a[i], b[i]), `${message}[${i}]: ${a[i]} ≠ ${b[i]}`);
}

test('the 256 possible sRGB bytes yield the same linear value as the explicit formula', () => {
  for (let octet = 0; octet <= 255; octet++) {
    const map = texture(1, 1, () => octet, THREE.ClampToEdgeWrapping);
    bitExact(sampleMap(map, 0, 0), referenceSampleMap(map, 0, 0), `octet ${octet}`);
  }
});

test('the 0 and 255 bounds land exactly on the table bounds', () => {
  const noir = texture(1, 1, () => 0, THREE.ClampToEdgeWrapping);
  const blanc = texture(1, 1, () => 255, THREE.ClampToEdgeWrapping);
  assert.deepEqual(sampleMap(noir, 0, 0), [0, 0, 0]);
  bitExact(sampleMap(blanc, 0, 0), [1, 1, 1], 'white');
  bitExact(sampleMap(blanc, 0, 0), referenceSampleMap(blanc, 0, 0), 'white vs reference');
});

test('a texture without an image yields white on both sides, even with non-finite uvs', () => {
  const sansImage = importHostTexture(new THREE.Texture());
  for (const [u, v] of [
    [NaN, 0.5],
    [Infinity, -Infinity],
    [-0, 0],
  ] as const) {
    bitExact(sampleMap(sansImage, u, v), referenceSampleMap(sansImage, u, v), `uv ${u},${v}`);
    bitExact(sampleLinear(sansImage, u, v), [1, 1, 1], `sampleLinear uv ${u},${v}`);
  }
});

test('extreme or signed uvs on a real image stay identical to the explicit formula', () => {
  const map = texture(4, 4, (i) => (i * 17) & 255, THREE.RepeatWrapping);
  const bordee = texture(4, 4, (i) => (i * 53) & 255, THREE.ClampToEdgeWrapping);
  // -0 wraps onto itself (Repeat) and Infinity clamps to the edge (ClampToEdge): two ways of
  // keeping a finite texel index.
  for (const [texture_, u, v] of [
    [map, -0, 0],
    [bordee, -1e9, 1e9],
    [bordee, Infinity, -Infinity],
  ] as const) {
    bitExact(sampleMap(texture_, u, v), referenceSampleMap(texture_, u, v), `sample uv ${u},${v}`);
  }
});

test('a non-finite uv that yields a NaN texel index yields NaN on both sides, never undefined', () => {
  const map = texture(4, 4, (i) => (i * 17) & 255, THREE.RepeatWrapping);
  const bordee = texture(4, 4, (i) => (i * 53) & 255, THREE.ClampToEdgeWrapping);
  // NaN breaks the index under any wrap; Infinity/-Infinity only break it under Repeat
  // (`t - Math.floor(t)` on an infinity is NaN), not under ClampToEdge (Math.max/Math.min absorb
  // them). Both sides must yield NaN, never `undefined`.
  for (const [texture_, u, v] of [
    [map, NaN, 0.2],
    [map, Infinity, -Infinity],
    [bordee, NaN, NaN],
  ] as const) {
    const obtenu = sampleMap(texture_, u, v);
    bitExact(obtenu, referenceSampleMap(texture_, u, v), `sample uv ${u},${v}`);
    assert.ok(
      obtenu.every((c) => Number.isNaN(c)),
      `sample uv ${u},${v}: ${obtenu}`,
    );
  }
});

// Lot F, F15: `textureRgba` (visibilityTypes.ts) keeps a texture's bytes as long as its source
// (buffer, offset, length, width, height) does not change, instead of allocating a view and an
// object at every sampled texel. The oracle is the unconditional allocation from before lot F,
// copied as-is into `oracles/texture-echantillonnee.ts`.
test('a texture without an image or without data yields null on both sides', () => {
  const sansImage = importHostTexture(new THREE.Texture());
  assert.equal(textureRgba(sansImage), referenceTextureRgba(sansImage));
  const largeurNulle = new THREE.Texture();
  largeurNulle.image = { data: new Uint8Array(4), width: 0, height: 1 };
  const vide = importHostTexture(largeurNulle);
  assert.equal(textureRgba(vide), referenceTextureRgba(vide));
});

test('two calls on the same image yield the same bytes as the reference, and the same memoised object', () => {
  const map = texture(2, 2, (i) => i & 255, THREE.ClampToEdgeWrapping);
  const premier = textureRgba(map);
  const second = textureRgba(map);
  assert.equal(second, premier, 'the same object is reused as long as the source does not change');
  const attendu = referenceTextureRgba(map);
  assert.deepEqual(Array.from(premier!.data), Array.from(attendu!.data));
  assert.equal(premier!.width, attendu!.width);
  assert.equal(premier!.height, attendu!.height);
});

test('an image replaced by a new buffer yields new bytes, identical to the reference', () => {
  const host = new THREE.Texture();
  host.image = { data: new Uint8Array(16).map((_, i) => i & 255), width: 2, height: 2 };
  const premier = textureRgba(importHostTexture(host));
  host.image = { data: new Uint8Array(16).fill(7), width: 2, height: 2 };
  const imported = importHostTexture(host);
  const second = textureRgba(imported);
  assert.notEqual(second, premier, 'a new source buffer invalidates the cache');
  assert.deepEqual(Array.from(second!.data), Array.from(referenceTextureRgba(imported)!.data));
});

test('a subview of the same buffer (different offset or length) is never confused with the original view', () => {
  const buffer = new Uint8Array(32).map((_, i) => i);
  const map = new THREE.Texture();
  map.image = { data: buffer.subarray(0, 16), width: 2, height: 2 };
  const premier = textureRgba(importHostTexture(map));
  map.image = { data: buffer.subarray(4, 20), width: 2, height: 2 }; // same buffer, other offset
  const imported = importHostTexture(map);
  const second = textureRgba(imported);
  assert.notEqual(second, premier, 'a different offset on the same buffer invalidates the cache');
  assert.deepEqual(Array.from(second!.data), Array.from(referenceTextureRgba(imported)!.data));
});

test('the same width/height but an image resized without changing buffer also invalidates the cache', () => {
  const buffer = new Uint8Array(64).fill(9);
  const map = new THREE.Texture();
  map.image = { data: buffer, width: 4, height: 4 };
  const premier = textureRgba(importHostTexture(map));
  map.image = { data: buffer, width: 8, height: 2 }; // same buffer, different dimensions
  const imported = importHostTexture(map);
  const second = textureRgba(imported);
  assert.notEqual(second, premier);
  assert.deepEqual(second, referenceTextureRgba(imported));
});
