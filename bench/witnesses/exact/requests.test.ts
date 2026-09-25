// The exact witness asks for whole groups, as the engine does (#486): the cut rule draws a group
// only once all of it is resident, so a wanted page brings its group-mates and the groups above.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExactPagesRequests, type ExactPagesRequestContext } from './requests.ts';
import { ruleDag } from '../../../packages/sdk-browser/src/page/cut/cutRule.fixture.ts';
import { RequestStamps } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';

test('a wanted page brings its group-mates and the groups above, asked for and kept', () => {
  const dag = ruleDag(64),
    s = dag.structure;
  const pages = dag.pages.map((page) => ({ ...page })) as unknown as PageRec[];
  const roots = [{ world: dag.world, pages, culling: dag.culling, structure: s }];
  const leaf = dag.pages.findIndex((page) => page.level === 0),
    group = s.owners[leaf];
  const mates = [...s.children.subarray(s.childOffsets[group], s.childOffsets[group + 1])];
  const tops = dag.pages.flatMap((page, p) => (page.group === null ? [p] : []));
  const requests = createExactPagesRequests({
    bootstrap: [],
    missingRoots: [],
    pendingScratch: [],
    urlScratch: [],
    requestStamps: new RequestStamps(0),
    desired: [pages[leaf]],
    shown: [],
    roots,
    byUrl: new Map(),
    bundled: true,
    frame: 0,
    cam: undefined,
  } as unknown as ExactPagesRequestContext);
  for (const urls of [requests.pendingUrls(), requests.pageUrls()]) {
    const asked = new Set(urls);
    for (const p of [...mates, ...tops]) assert.ok(asked.has(pages[p].url), `${pages[p].url}`);
    assert.ok(mates.length > 1 && asked.size > mates.length, 'more than the wanted page');
  }
});
