import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from './index.ts';
import { clusterSphere, DAG, MANIFEST_IDENTITY } from './pagesBackendFixture.ts';
import {
  quadScene,
  quadCluster,
  frontCamera,
  assertSingleCoarseCluster,
  coarseQuadContext,
} from './pagesBackendScenes.ts';

test('pixelError is read from the context each frame', () => {
  const { geometry, material, context } = coarseQuadContext(0);
  const backend = exactPagesBackend(context);
  const camera = frontCamera();
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 2);
  context.pixelError = 10;
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 1);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('a three-level DAG picks the middle reduction and skips the one above it', () => {
  const { geometry, material, mesh, source } = quadScene();
  // Three levels: clusters 0+1 reduce to 2, which reduces to 3. At 10 px only the middle level fits.
  const cluster = quadCluster;
  const mid = 0.001,
    top = 1e6,
    sphere = clusterSphere(cluster(2));
  const pages = [
    ...[0, 1].map((id) => ({
      ...cluster(id),
      role: 'exact' as const,
      start: id * 3,
      level: 0,
      lodError: 0,
      sphere: clusterSphere(cluster(id)),
      parentError: mid,
      parentSphere: sphere,
      group: 0,
      source: null,
    })),
    {
      ...cluster(2),
      role: 'coarse' as const,
      start: 0,
      level: 1,
      lodError: mid,
      sphere,
      parentError: top,
      parentSphere: sphere,
      group: 1,
      source: 0,
    },
    {
      ...cluster(3),
      role: 'coarse' as const,
      start: 0,
      level: 2,
      lodError: top,
      sphere,
      parentError: null,
      parentSphere: null,
      group: null,
      source: 1,
    },
  ];
  const structure = {
    version: 1,
    roots: [3],
    groups: [
      { level: 1, error: mid, sphere, children: [0, 1], outputs: [2] },
      { level: 2, error: top, sphere, children: [2], outputs: [3] },
    ],
  };
  const backend = exactPagesBackend({
    source,
    metadata: {
      ...DAG,
      ...MANIFEST_IDENTITY,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', pages, structure }],
    },
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
      ['2', new Uint32Array([0, 1, 2])],
      ['3', new Uint32Array([0, 2, 3])],
    ]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    pixelError: 10,
    viewport: [960, 540],
  });
  assertSingleCoarseCluster(backend, { geometry, material });
});
