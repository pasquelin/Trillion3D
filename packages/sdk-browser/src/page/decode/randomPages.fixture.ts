import { encodeGeometryPage } from '../../../../page-codec/geometryPage.ts';
import type { DecodedGeometryPage } from './geometryPage.ts';

/** A seeded generator in [0, 1): the same pages on every run. */
export function seeded(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** A geometry page of `vertices` random vertices — signed zeros among them — with normals and
 *  texture coordinates on one page in two, so attribute names travel too. */
export function randomPage(random: () => number, vertices: number) {
  const position = new Float32Array(vertices * 3),
    normal = new Float32Array(vertices * 3),
    uv = new Float32Array(vertices * 2);
  for (let i = 0; i < position.length; i++)
    position[i] = random() < 0.05 ? -0 : (random() - 0.5) * 2000;
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

/** First difference between two decoded pages, value by value (`Object.is`), or `null`. */
export function pageGap(a: DecodedGeometryPage, b: DecodedGeometryPage) {
  for (const key of ['vertexCount', 'flags', 'decodedBytes', 'quantizationError'] as const)
    if (!Object.is(a[key], b[key])) return `${key}: ${a[key]} ≠ ${b[key]}`;
  const names = Object.keys(a.attributes);
  if (names.join() !== Object.keys(b.attributes).join()) return `names ${names.join()}`;
  const arrays: [string, ArrayLike<number>, ArrayLike<number>][] = [
    ['indices', a.indices, b.indices],
  ];
  for (const name of names) arrays.push([name, a.attributes[name], b.attributes[name]]);
  for (const [name, left, right] of arrays) {
    if (left.length !== right.length) return `${name}: length ${left.length} ≠ ${right.length}`;
    for (let i = 0; i < left.length; i++)
      if (!Object.is(left[i], right[i])) return `${name}[${i}]: ${left[i]} ≠ ${right[i]}`;
  }
  return null;
}
