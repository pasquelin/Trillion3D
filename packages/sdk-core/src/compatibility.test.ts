import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFormat,
  assertCacheIdentity,
  CLUSTERED_BLEND_FORMAT_VERSION,
  DAG_ERROR_MODEL,
  EngineError,
  FORMAT_VERSION,
  compareImages,
} from './index.ts';

/** One exact root page over the unit box, named by its id. */
const page = (id: number) => ({
  id,
  url: `${id}`,
  sha256: 'x',
  bytes: 12,
  count: 3,
  min: [0, 0, 0],
  max: [1, 1, 1],
  role: 'exact' as const,
  level: 0,
  lodError: 0,
  sphere: [0, 0, 0, 1],
  parentError: null,
  parentSphere: null,
});
test('Public core imports without DOM and rejects unknown format with a structured code', () => {
  assert.equal(typeof (globalThis as { document?: unknown }).document, 'undefined');
  assertFormat(FORMAT_VERSION);
  assert.throws(
    () => assertFormat(999),
    (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
  );
  assert.equal(
    compareImages(new Uint8Array([1, 2, 3, 255]), new Uint8Array([1, 2, 3, 255])).differentPixels,
    0,
  );
});
test('a cache without a cluster DAG is refused by name, with the primitive that lacks one', () => {
  const base = {
    schema: FORMAT_VERSION,
    formatVersion: FORMAT_VERSION,
    status: 'ready',
    key: 'k',
    scope: 'full' as const,
    sourceTriangles: 1,
    selectedTriangles: 1,
    selectedNodes: 1,
    totalNodes: 1,
    errorModel: DAG_ERROR_MODEL,
    clusterStrategy: 'dag-groups' as const,
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        clusterStrategy: 'dag-groups' as const,
        pages: [page(0)],
      },
    ],
  };
  assertCacheIdentity(base);
  // The old page tree: clusters with no band of their own. Refused, and the message says which one.
  const tree = {
    ...base,
    primitives: [
      { ...base.primitives[0], pages: [{ ...page(0), lodError: undefined, sphere: undefined }] },
    ],
  };
  assert.throws(
    () => assertCacheIdentity(tree),
    (error: unknown) =>
      error instanceof EngineError &&
      error.code === 'STALE_CACHE' &&
      /without a cluster DAG/.test(error.message) &&
      error.details.primitive === 0,
  );
  // A DAG whose model is not the certified one is refused too.
  for (const errorModel of ['bounds-diagonal-boundary-v1', undefined])
    assert.throws(
      () => assertCacheIdentity({ ...base, errorModel }),
      (error: unknown) => error instanceof EngineError && error.code === 'STALE_CACHE',
    );
  // An empty primitive carries no band either: it cannot be drawn, so it is refused, not skipped.
  assert.throws(
    () => assertCacheIdentity({ ...base, primitives: [{ ...base.primitives[0], pages: [] }] }),
    (error: unknown) => error instanceof EngineError && error.code === 'STALE_CACHE',
  );
});
test('cache readers accept the current format and the clustered BLEND one explicitly', () => {
  assertFormat(FORMAT_VERSION);
  assertFormat(CLUSTERED_BLEND_FORMAT_VERSION);
  // Formats 1 and 2 have no per-cluster coplanar layer column: refused, never half-read.
  for (const version of [0, 1, 2, 999])
    assert.throws(
      () => assertFormat(version),
      (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
    );
  const blend = {
    schema: CLUSTERED_BLEND_FORMAT_VERSION,
    formatVersion: CLUSTERED_BLEND_FORMAT_VERSION,
    status: 'ready',
    key: 'blend-v2',
    scope: 'full' as const,
    sourceTriangles: 1,
    selectedTriangles: 1,
    selectedNodes: 1,
    totalNodes: 1,
    errorModel: DAG_ERROR_MODEL,
    clusterStrategy: 'dag-groups' as const,
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'clustered-blend',
        clusterStrategy: 'dag-groups' as const,
        pages: [page(0)],
      },
    ],
  };
  assertCacheIdentity(blend);
  assert.throws(
    () => assertCacheIdentity({ ...blend, schema: FORMAT_VERSION, formatVersion: FORMAT_VERSION }),
    (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
  );
});
