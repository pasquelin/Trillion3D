import assert from 'node:assert/strict';
import { encodeGeometryPage } from '../../../../page-codec/geometryPage.ts';
import { assertBits } from '../../../../../tests/kit/assert/bits.ts';
import type { DecodedGeometryPage } from './geometryPage.ts';

/** A geometry page of `vertices` random vertices — signed zeros among them — with normals and
 *  texture coordinates on one page in two, so attribute names travel too. */
export function randomPage(random: () => number, vertices: number) {
  const position = new Float32Array(vertices * 3),
    normal = new Float32Array(vertices * 3),
    uv = new Float32Array(vertices * 2);
  for (let i = 0; i < position.length; i++)
    position[i] = random() < 0.05 ? -0 : (random() - 0.5) * 200;
  for (let i = 0; i < normal.length; i++) normal[i] = random() < 0.1 ? -0 : random() * 2 - 1;
  for (let i = 0; i < uv.length; i++) uv[i] = random();
  const indices = Array.from({ length: Math.max(1, Math.floor(vertices / 3)) * 3 }, (_, i) =>
    i < vertices ? i : Math.floor(random() * vertices),
  );
  const full = random() < 0.5;
  const { data } = encodeGeometryPage(indices, {
    POSITION: { itemSize: 3, array: position },
    ...(full
      ? { NORMAL: { itemSize: 3, array: normal }, TEXCOORD_0: { itemSize: 2, array: uv } }
      : {}),
  });
  return data as Uint8Array;
}

/**
 * The edge cases the audit lists that a page can carry: signed zeros (in `randomPage`), the
 * smallest page — one triangle — and the maximal one, 65,535 vertices. NaN and ±Infinity never
 * reach a page: the encoder refuses them (`PAGE_ATTRIBUTE_NONFINITE`), which `nonFinite` holds.
 */
export function edgePages(random: () => number) {
  return [randomPage(random, 3), randomPage(random, 65535)];
}
export const nonFinite = [NaN, Infinity, -Infinity].map(
  (value) => () =>
    encodeGeometryPage([0, 1, 2], {
      POSITION: { itemSize: 3, array: new Float32Array([value, 0, 0, 1, 0, 0, 0, 1, 0]) },
    }),
);

/** Fails on the first difference between two decoded pages, value by value (`Object.is`). */
export function assertSamePage(a: DecodedGeometryPage, b: DecodedGeometryPage, label: string) {
  for (const key of ['vertexCount', 'flags', 'decodedBytes', 'quantizationError'] as const)
    assert.ok(Object.is(a[key], b[key]), `${label} ${key}: ${a[key]} !== ${b[key]}`);
  assert.deepEqual(Object.keys(a.attributes), Object.keys(b.attributes), `${label} names`);
  assertBits(a.indices, b.indices, `${label} indices`);
  for (const name of Object.keys(a.attributes))
    assertBits(a.attributes[name], b.attributes[name], `${label} ${name}`);
}
