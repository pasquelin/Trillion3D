import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
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
  await awaitBackendPages(backend, G.perspectiveCamera(), async (urls) => {
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
  await awaitBackendPages(backend, G.perspectiveCamera(), async () => {
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
    G.perspectiveCamera(),
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
    G.perspectiveCamera(),
    async () => {
      loaded = true;
    },
  );
  assert.equal(synced, true);
});

test('awaitPages returns on a fixed search, its pages resident', async () => {
  // The WebGL2 backend fixes its threshold search in `flush`, one cut a rung, before the wait
  // asks for the pages: those of the fixed cut are then the ones loaded.
  let rung = 0;
  const resident = new Set<number>();
  await awaitBackendPages(
    {
      render() {},
      async flush() {
        while (rung < 4) rung++;
      },
      pendingUrls() {
        return resident.has(rung) ? [] : [`rung-${rung}`];
      },
    },
    G.perspectiveCamera(),
    async (urls) => {
      for (const url of urls) resident.add(Number(url.slice(5)));
    },
  );
  assert.equal(rung, 4, 'the search is fixed');
  assert.deepEqual([...resident], [4], 'only the pages of the fixed cut were loaded');
});

test('a wait for pages alone asks every flush for no image (#408)', async () => {
  const asked: unknown[] = [];
  const backend = {
    render() {},
    async flush(options?: { image?: boolean }) {
      asked.push(options);
    },
    pendingUrls: () => [],
  };
  await awaitBackendPages(backend, G.perspectiveCamera(), async () => {}, { image: false });
  assert.deepEqual(asked, [{ image: false }, { image: false }, { image: false }]);
});
