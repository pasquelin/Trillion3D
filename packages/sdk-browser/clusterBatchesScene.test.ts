import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClusterBatches } from './clusterBatches.ts';
import { attributes, fixture, resident, drawOf } from './clusterBatchesFixture.ts';

test('instances of one primitive share a single resident index buffer written once per page', () => {
  const scene = new THREE.Scene(),
    data = fixture();
  const batches = new ClusterBatches(scene, data.pages);
  resident(batches, data, ['a', 'b', 'c', 'd']);
  // a=6, b=9, c=3 indices for the shared primitive; d=12 for the other.
  assert.equal(batches.metrics.pageRangeWrites, 4, 'one write per page, not one per instance');
  assert.equal(batches.metrics.indexBytesWritten, (6 + 9 + 3 + 12) * 4);
  assert.equal(
    batches.indexBytes,
    (6 + 9 + 3 + 12) * 4,
    'capacity = sum of the pages of each primitive',
  );

  batches.update(data.pages);
  const first = drawOf(scene, 0)!,
    second = drawOf(scene, 1)!,
    third = drawOf(scene, 2)!;
  assert.equal(
    first.geometry,
    second.geometry,
    'the two instances share the geometry and its index',
  );
  assert.notEqual(first.geometry, third.geometry);
  assert.equal(first.count, 1, 'the three pages are contiguous: a single sub-draw');
  assert.deepEqual(first.starts, [0]);
  assert.deepEqual(first.counts, [18]);
  assert.deepEqual(second.counts, [18]);
  assert.deepEqual(third.counts, [12]);
  assert.equal(batches.metrics.drawCalls, 3);
  assert.equal(batches.metrics.submittedTriangles, (2 + 3 + 1) * 2 + 4);
  assert.equal(scene.children.length, 3);
});
test('a cut that changes every frame rewrites no index and detaches the groups it drops', () => {
  const scene = new THREE.Scene(),
    data = fixture();
  const batches = new ClusterBatches(scene, data.pages);
  resident(batches, data, ['a', 'b', 'c', 'd']);
  batches.update(data.pages);
  const writes = batches.metrics.pageRangeWrites,
    bytes = batches.metrics.indexBytesWritten;

  // Cut 2: instance 1 disappears, instance 0 keeps only pages a and c (non-adjacent).
  const cut = data.pages.filter(
    (page) => (page.renderOrder === 0 && page.url !== 'b') || page.renderOrder === 2,
  );
  batches.update(cut);
  assert.equal(batches.metrics.pageRangeWrites, writes, 'no range rewritten');
  assert.equal(batches.metrics.indexBytesWritten, bytes, 'no index byte re-uploaded');
  assert.equal(drawOf(scene, 1), undefined, 'the group with no visible page is detached');
  const first = drawOf(scene, 0)!;
  assert.equal(first.count, 2, 'a and c are not adjacent: two sub-draws');
  assert.deepEqual(first.starts, [0, 15 * 4]);
  assert.deepEqual(first.counts, [6, 3]);
  assert.equal(batches.metrics.drawCalls, 2);

  // Back to the full cut: the group is re-attached, still with no index write.
  batches.update(data.pages);
  assert.equal(batches.metrics.pageRangeWrites, writes);
  assert.equal(drawOf(scene, 1)!.counts[0], 18);
  assert.equal(batches.metrics.drawCalls, 3);
});
test('an evicted page frees its range and the next residency reuses it', () => {
  const scene = new THREE.Scene(),
    data = fixture();
  const batches = new ClusterBatches(scene, data.pages);
  resident(batches, data, ['a', 'b', 'c']);
  batches.update(data.pages);
  assert.deepEqual(drawOf(scene, 0)!.counts, [18]);

  for (const page of data.byUrl.get('b')!) page.array = undefined;
  batches.dropPage(data.byUrl.get('b')!);
  batches.update(data.pages);
  const partial = drawOf(scene, 0)!;
  assert.deepEqual(partial.starts, [0, 15 * 4]);
  assert.deepEqual(partial.counts, [6, 3], 'a and c stay in place, the hole of b is skipped');

  resident(batches, data, ['b']);
  batches.update(data.pages);
  const back = drawOf(scene, 0)!;
  assert.equal(back.count, 1, 'b takes back exactly its hole: everything becomes contiguous again');
  assert.deepEqual(back.counts, [18]);
});
test('a transparent group draws its pages in source order whatever the order of the cut', () => {
  const material = new THREE.MeshBasicMaterial({ transparent: true });
  const attrs = attributes(64);
  const matrix = new THREE.Matrix4();
  const pages: BatchPage[] = [0, 1, 2].map((id) => ({
    id,
    url: `t${id}`,
    triangles: 1,
    min: [0, 0, 0],
    max: [1, 1, 1],
    attributes: attrs,
    material,
    matrix,
    renderOrder: 0,
    transparent: true,
    sourceOrder: [2, 0, 1][id],
  }));
  const scene = new THREE.Scene();
  const batches = new ClusterBatches(scene, pages);
  for (const page of pages) {
    const array = Uint32Array.from([0, 1, 2]);
    page.array = array;
    batches.acceptPage([page], array);
  }
  batches.update([pages[0], pages[1], pages[2]]);
  const forward = drawOf(scene, 0)!;
  batches.update([pages[2], pages[0], pages[1]]);
  const shuffled = drawOf(scene, 0)!;
  assert.deepEqual(shuffled.starts, forward.starts, 'stable draw order');
  assert.deepEqual(shuffled.counts, forward.counts);
  // sourceOrder = [2,0,1] -> page 1 (range 3), page 2 (range 6), page 0 (range 0);
  // ranges 3 and 6 follow each other, they merge into a single sub-draw without changing the order.
  assert.deepEqual(forward.starts, [3 * 4, 0]);
  assert.deepEqual(forward.counts, [6, 3]);
});
test('draw groups keep opaque first then transparent source rank and coplanar layer', () => {
  const attrs = attributes(12),
    matrix = new THREE.Matrix4(),
    opaque = new THREE.MeshBasicMaterial(),
    blend = new THREE.MeshBasicMaterial({ transparent: true });
  const pages: BatchPage[] = [
    {
      ...fixture().pages[0],
      id: 0,
      url: 'opaque',
      attributes: attrs,
      material: opaque,
      matrix,
      renderOrder: 0,
    },
    {
      ...fixture().pages[0],
      id: 1,
      url: 'late',
      attributes: attrs,
      material: blend,
      matrix,
      renderOrder: 2,
      transparent: true,
    },
    {
      ...fixture().pages[0],
      id: 2,
      url: 'early',
      attributes: attrs,
      material: blend,
      matrix,
      renderOrder: 1,
      transparent: true,
      depthLayer: 2,
    },
  ];
  const batches = new ClusterBatches(new THREE.Scene(), pages);
  for (const page of pages) {
    page.array = Uint32Array.from([0, 1, 2]);
    batches.acceptPage([page], page.array);
  }
  batches.update([pages[1], pages[2], pages[0]]);
  const active = (batches as unknown as { active: Array<{ sample: BatchPage; layer: number }> })
    .active;
  assert.deepEqual(
    active.map((group) => [group.sample.renderOrder, group.layer]),
    [
      [0, 0],
      [1, 2],
      [2, 0],
    ],
  );
});
test('page urls of a cut are listed once per page, instances included, and diagnostics can hide every batch', () => {
  const scene = new THREE.Scene(),
    data = fixture();
  const batches = new ClusterBatches(scene, data.pages);
  resident(batches, data, ['a', 'b', 'c', 'd']);
  const urls: string[] = [];
  batches.markUrls(data.pages, 1, urls);
  assert.deepEqual(urls.sort(), ['a', 'b', 'c', 'd']);
  const again: string[] = [];
  batches.markUrls(data.pages, 2, again);
  assert.equal(again.length, 4, 'a new stamp gives back the full list');

  batches.update(data.pages);
  assert.equal(scene.children.length, 3);
  batches.hideAll();
  assert.equal(scene.children.length, 0);
  assert.equal(batches.metrics.drawCalls, 0);
  batches.update(data.pages);
  assert.equal(scene.children.length, 3, 'beauty mode reattaches the same batches');
  batches.dispose();
  assert.equal(scene.children.length, 0);
});
