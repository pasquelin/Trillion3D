// #1237: the pool's floor is the root cover and the pages its groups replace, admitted first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { admissionLevel, floorFirst, rootChildren } from './minimumCapacity.ts';
import { structureIndex } from '../page/selection/structure.ts';
import type { ClusterRoot, PageRec } from '../page/selection/types.ts';

/** Leaves `0`–`3` under `4` and `5`, those two under the root `6`: two levels below a root. */
function placement() {
  const pages = [0, 0, 0, 0, 1, 1, 2].map((level, id) => ({ url: `p${id}`, level }) as PageRec);
  const structure = structureIndex(
    {
      version: 1,
      roots: [6],
      groups: [
        { level: 1, error: 1, sphere: [0, 0, 0, 1], children: [0, 1], outputs: [4] },
        { level: 1, error: 1, sphere: [0, 0, 0, 1], children: [2, 3], outputs: [5] },
        { level: 2, error: 2, sphere: [0, 0, 0, 2], children: [4, 5], outputs: [6] },
      ],
    },
    pages.length,
  );
  return { pages, root: { pages, structure } as unknown as ClusterRoot<PageRec> };
}

test('the floor holds the pages the group of a root replaces, and nothing finer', () => {
  const { pages, root } = placement();
  assert.deepEqual(
    rootChildren([root]).map((page) => page.url),
    ['p4', 'p5'],
  );
  assert.deepEqual(
    pages.filter((page) => page.rootChild).map((page) => page.url),
    ['p4', 'p5'],
    'each marked once, the leaves left out',
  );
  assert.deepEqual(rootChildren([root]), [], 'a page already marked is not counted twice');
});

test('the floor is admitted before any level, then the coarsest level first', () => {
  const { pages, root } = placement();
  rootChildren([root]);
  const coarse = { url: 'other', level: 5 } as PageRec;
  const order = [pages[0], coarse, pages[4], pages[1]].sort(floorFirst).map((page) => page.url);
  assert.deepEqual(order, ['p4', 'other', 'p0', 'p1']);
  assert.equal(admissionLevel(pages[4], 5), 7, 'ranked past the highest level');
  assert.equal(admissionLevel(coarse, 5), 5);
});
