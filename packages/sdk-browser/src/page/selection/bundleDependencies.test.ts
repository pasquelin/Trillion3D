import test from 'node:test';
import assert from 'node:assert/strict';
import type { Primitive } from '../../../../sdk-core/src/index.ts';
import type { PageRec } from './types.ts';
import { linkBundleDependencies, withClosure } from './bundleDependencies.ts';

const recs = (names: string[]) => names.map((url) => ({ url }) as PageRec);
const primitive = (streams: number[], dependencies: number[][]) =>
  ({
    pages: streams.map((stream) => ({ stream })),
    streams: { pages: dependencies.map((list) => ({ url: 'b', dependencies: list })) },
  }) as unknown as Primitive;

test("a record's dependencies are one record of each fetched bundle its bundle lists", () => {
  const pages = recs(['r', 'm', 'a', 'b']);
  linkBundleDependencies(primitive([0, 1, 2, 2], [[], [0], [0, 1]]), pages);
  const [r, m, a, b] = pages;
  assert.deepEqual(r.dependencies, []);
  assert.deepEqual(m.dependencies, [r]);
  assert.equal(a.dependencies, b.dependencies, 'one list per bundle, shared');
  assert.deepEqual(a.dependencies, [r, m]);
  // A bundle whose clusters read a quantized geometry page is never fetched: it is not listed.
  const quantized = recs(['r', 'm']);
  quantized[0].geometryPage = {} as never;
  linkBundleDependencies(primitive([0, 1], [[], [0]]), quantized);
  assert.deepEqual(quantized[1].dependencies, []);
});

test('the retained cut carries the bundles it is installed after', () => {
  const pages = recs(['r', 'm', 'a']);
  linkBundleDependencies(primitive([0, 1, 2], [[], [0], [0, 1]]), pages);
  const marked: string[] = [];
  withClosure([pages[2]], (list) => list.forEach((rec) => marked.push(rec.url)));
  assert.deepEqual(marked, ['a', 'r', 'm']);
});
