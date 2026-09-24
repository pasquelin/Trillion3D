import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { awaitBackendPages } from './awaitBackendPages.ts';

test('awaiting GPU pages resolves wanted readback, uploads pages and renders the resident cut', async () => {
  let requested = false,
    bytes = false,
    resident = false,
    drawn = false,
    uploadQueued = false;
  const backend = {
    render() {
      drawn = resident;
      if (requested && bytes) uploadQueued = true;
    },
    async flush() {
      requested = true;
      if (uploadQueued) resident = true;
    },
    pendingUrls() {
      return requested && !bytes ? ['fine-page'] : [];
    },
  };
  const loads: string[][] = [];
  await awaitBackendPages(backend, new THREE.PerspectiveCamera(), async (urls) => {
    loads.push(urls);
    bytes = true;
  });
  assert.deepEqual(loads, [['fine-page']]);
  assert.equal(resident, true);
  assert.equal(drawn, true, 'the final image must use the uploaded detail');
});

test('awaiting already cached GPU bytes still settles GPU upload before the final image', async () => {
  let requested = false,
    resident = false,
    drawn = false,
    uploadQueued = false;
  const backend = {
    render() {
      drawn = resident;
      if (requested) uploadQueued = true;
    },
    async flush() {
      requested = true;
      if (uploadQueued) resident = true;
    },
    pendingUrls() {
      return [];
    },
  };
  await awaitBackendPages(backend, new THREE.PerspectiveCamera(), async () => {
    assert.fail('cached bytes must not be fetched again');
  });
  assert.equal(drawn, true);
});

test('synchronous backends keep one selection when their pages are already available', async () => {
  let renders = 0;
  await awaitBackendPages(
    {
      render() {
        renders++;
      },
      pendingUrls() {
        return [];
      },
    },
    new THREE.PerspectiveCamera(),
    async () => assert.fail('unexpected request'),
  );
  assert.equal(renders, 1);
});

test('synchronous backends accept missing pages before syncing residency', async () => {
  let loaded = false,
    synced = false;
  await awaitBackendPages(
    {
      render() {},
      pendingUrls() {
        return ['page'];
      },
      syncResident() {
        assert.equal(loaded, true);
        synced = true;
      },
    },
    new THREE.PerspectiveCamera(),
    async () => {
      loaded = true;
    },
  );
  assert.equal(synced, true);
});

test('a budget search is awaited until it settles and the settled cut is resident', async () => {
  // Each image steps the threshold one rung finer until the fourth; each rung asks for its page.
  let rung = 0,
    renders = 0;
  const resident = new Set<number>();
  await awaitBackendPages(
    {
      render() {
        renders++;
        if (rung < 4 && resident.has(rung)) rung++;
      },
      async flush() {},
      pendingUrls() {
        return resident.has(rung) ? [] : [`rung-${rung}`];
      },
      cutSettling: () => rung < 4,
    },
    new THREE.PerspectiveCamera(),
    async (urls) => {
      for (const url of urls) resident.add(Number(url.slice(5)));
    },
  );
  assert.equal(rung, 4, 'the search settled');
  assert.ok(resident.has(4), 'the pages of the settled cut are resident');
  assert.ok(renders < 40);
});
