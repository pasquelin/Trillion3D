// A7 : les ensembles d'urls de résidence (pendingUrls, pageUrls, collectPendingUrls) vivent aussi
// longtemps que l'hôte au lieu d'être reconstruits par image ; A8 : comptePagesResidentes compte au
// lieu d'allouer un tableau intermédiaire. Oracle : les versions d'avant le lot A, dans
// `bench/oracles/selection.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPendingUrls } from './pageSelectionRequests.ts';
import { comptePagesResidentes, createAutonomousResidency } from './autonomousResidency.ts';
import { referenceCollectPendingUrls, referenceResidency } from './bench/oracles/selection.mjs';

function makeEnv() {
  const bootstrapUrls = new Set(['a.bin', 'b.bin']),
    modifiedPages = new Set(['c.bin']);
  const shown = [{ url: 'a.bin' }, { url: 'd.bin' }],
    desired = [
      { url: 'a.bin', array: new Uint32Array(3) },
      { url: 'e.bin' },
      { url: 'e.bin' }, // duplicate url in the desired list, on purpose
      { url: 'f.bin' },
    ];
  return { bootstrapUrls, modifiedPages, shown, desired };
}

test('pendingUrls and pageUrls match the reference on a normal host, called twice in a row', () => {
  const env = makeEnv();
  const optimisee = createAutonomousResidency({
    ...env,
    pending: [],
    retained: [],
    byUrl: new Map(),
    geometryStore: { detach: () => {}, state: { allocationBytes: 0 } },
  });
  const reference = referenceResidency({ ...env, pending: [], retained: [] });
  for (const pass of [0, 1]) {
    assert.deepEqual(optimisee.pendingUrls(), reference.pendingUrls(), `pending pass ${pass}`);
    assert.deepEqual(optimisee.pageUrls(), reference.pageUrls(), `retained pass ${pass}`);
  }
});

test('an empty host produces empty sets from both implementations', () => {
  const empty = {
    bootstrapUrls: new Set<string>(),
    modifiedPages: new Set<string>(),
    shown: [],
    desired: [],
  };
  const optimisee = createAutonomousResidency({
    ...empty,
    pending: [],
    retained: [],
    byUrl: new Map(),
    geometryStore: { detach: () => {}, state: { allocationBytes: 0 } },
  });
  const reference = referenceResidency({ ...empty, pending: [], retained: [] });
  assert.deepEqual(optimisee.pendingUrls(), []);
  assert.deepEqual(reference.pendingUrls(), []);
  assert.deepEqual(optimisee.pageUrls(), []);
  assert.deepEqual(reference.pageUrls(), []);
});

test('collectPendingUrls dedups by streamUrl and skips resident pages, matching the reference', () => {
  const shown = [
    { url: 'p0.bin', array: new Uint32Array(1) }, // resident: skipped
    { url: 'p1.bin', streamUrl: 'bundle.bin' },
    { url: 'p2.bin', streamUrl: 'bundle.bin' }, // same bundle: deduped
    { url: 'p3.bin' },
  ];
  const optimisee = collectPendingUrls(shown, []);
  const reference = referenceCollectPendingUrls(shown, []);
  assert.deepEqual(optimisee, reference);
  assert.deepEqual(optimisee, ['bundle.bin', 'p3.bin']);
});

test('collectPendingUrls on an empty list returns an empty array from both sides', () => {
  assert.deepEqual(collectPendingUrls([], []), []);
  assert.deepEqual(referenceCollectPendingUrls([], []), []);
});

test('comptePagesResidentes counts resident pages without building an intermediate array', () => {
  const pages = [{ array: new Uint32Array(1) }, {}, { array: new Uint32Array(0) }, {}];
  assert.equal(comptePagesResidentes(pages), 2);
  assert.equal(comptePagesResidentes(pages), pages.filter((p) => !!p.array).length);
  assert.equal(comptePagesResidentes([]), 0);
});
