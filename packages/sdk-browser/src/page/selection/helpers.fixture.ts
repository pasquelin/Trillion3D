import assert from 'node:assert/strict';
import { dagFixture } from './dag.fixture.ts';
import { collectClusterPages } from './selection.ts';

export function assertOneRepresentationPerGroup(shown: readonly string[]) {
  const drawn = new Set(shown);
  const regions = [
    { children: ['leaf0', 'leaf1'], output: 'mid-left' },
    { children: ['leaf2', 'leaf3'], output: 'mid-right' },
    { children: ['mid-left', 'mid-right'], output: 'root' },
  ];
  for (const region of regions) {
    const fine = region.children.filter((url) => drawn.has(url)).length;
    const coarse = drawn.has(region.output) ? 1 : 0;
    // A region is covered by its own output, by its children, or by something coarser above it.
    assert.ok(!(coarse && fine), `${region.output}: covered twice`);
  }
  // Exactly one representation of the whole surface.
  const leftCovered =
    drawn.has('root') || drawn.has('mid-left') || (drawn.has('leaf0') && drawn.has('leaf1'));
  const rightCovered =
    drawn.has('root') || drawn.has('mid-right') || (drawn.has('leaf2') && drawn.has('leaf3'));
  assert.ok(leftCovered && rightCovered, `hole in ${[...drawn].join(',')}`);
}

export function dagCulling() {
  const rootSphere = [0, 0, 0, 2.3];
  const both = [0, 0, 0, 2.2];
  const whole = [-2, -0.5, 0, 2, 0.5, 0];
  const node = (
    box: number[],
    sphere: number[],
    maxParent: number,
    firstChild: number,
    childCount: number,
    firstPage: number,
    pageCount: number,
  ) => [...box, ...sphere, maxParent, firstChild, childCount, firstPage, pageCount];
  return {
    stride: 15,
    count: 3,
    nodes: [
      ...node(whole, rootSphere, -1, 1, 2, 0, 0),
      ...node(whole, both, 0.02, 0, 0, 0, 4),
      ...node(whole, rootSphere, -1, 0, 0, 4, 3),
    ],
  };
}

/** Zero-threshold cut request that holds resident pages, at a 1280×720 viewport. */
export const HELD_EXACT_ASK = {
  pixelError: 0,
  viewport: [1280, 720] as [number, number],
  holdResident: true,
};

/** The test DAG with its node hierarchy, collected into cluster roots. */
export function culledDagRoots() {
  const fixture = dagFixture();
  fixture.metadata.primitives[0].culling = dagCulling();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  return { fixture, roots };
}

export function withBundles(fixture: ReturnType<typeof dagFixture>) {
  const pages = fixture.metadata.primitives[0].pages;
  const rootPages = pages.filter((page) => page.parentError == null),
    rest = pages.filter((page) => page.parentError != null);
  const layout = (list: typeof pages, stream: number) => {
    let offset = 0;
    for (const page of list) {
      page.stream = stream;
      page.streamOffset = offset;
      offset += page.count * 4;
    }
    return offset;
  };
  const rootBytes = layout(rootPages, 0),
    restBytes = layout(rest, 1);
  fixture.metadata.primitives[0].streams = {
    version: 1,
    pinned: 1,
    bundleBytes: 65536,
    maxDependencies: 1,
    pages: [
      {
        url: 'bundle-roots',
        sha256: 'roots',
        bytes: rootBytes,
        count: rootPages.length,
        dependencies: [],
      },
      {
        url: 'bundle-rest',
        sha256: 'rest',
        bytes: restBytes,
        count: rest.length,
        dependencies: [0],
      },
    ],
  };
  const pack = (list: typeof pages) => {
    const array = new Uint32Array(list.reduce((sum, page) => sum + page.count, 0));
    let at = 0;
    for (const page of list) {
      array.set(fixture.indices.get(page.url) ?? new Uint32Array(page.count), at);
      at += page.count;
    }
    return array;
  };
  return { roots: pack(rootPages), rest: pack(rest) };
}
