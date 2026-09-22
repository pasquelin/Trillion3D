// Spec C4: a cluster's certified error is `lodError + maxPositionError`. An engine draws the
// quantized surface, which stands up to that distance from the one the compiler measured the
// band on, so the two lengths add — in object units, nothing weighted — and the pixel threshold
// then bounds what is drawn. Boxes grow by the same length, on the clusters and on the culling
// nodes that enclose them, so culling never cuts a surface the grid pushed outside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages } from './pageSelection.ts';
import { cullingNodes, quantizationErrorOf } from './pageSelectionHelpers.ts';
import { structureIndex } from './pageSelectionStructure.ts';
import { dagLevel } from './webgpuPagesTestDag.ts';
import { QUAD_MANIFEST, quadIndices, quadScene } from './pagesBackendScenes.ts';
import type { ClusterManifest, PrimitiveQuantization } from '../sdk-core/index.ts';

const ERROR = 0.25;
const QUANTIZATION: PrimitiveQuantization = {
  positionExponent: -4,
  uvExponent: -14,
  maxPositionError: ERROR,
};
const box = (id: number) => ({
  id,
  url: String(id),
  count: 3,
  min: [-1, -1, 0],
  max: [1, 1, 0],
  bytes: 12,
  sha256: 'x',
});

function scene(quantization: PrimitiveQuantization | null) {
  const { geometry, material, mesh, source } = quadScene();
  const level = dagLevel([box(0), box(1)], box(2), 0.5);
  const metadata: ClusterManifest = {
    ...QUAD_MANIFEST,
    primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...level, quantization }],
  };
  const associations = new Map([[mesh, { meshes: 0, primitives: 0 }]]);
  const collected = collectClusterPages(source, metadata, quadIndices(), associations, {
    allowMissing: true,
  });
  geometry.dispose();
  material.dispose();
  return { collected, level };
}

test('a cluster certifies its LOD error plus what the grid displaced', () => {
  const plain = scene(null).collected.allPages;
  const quantized = scene(QUANTIZATION).collected.allPages;
  for (const [i, rec] of quantized.entries()) {
    assert.equal(rec.lodError, plain[i].lodError! + ERROR);
    if (plain[i].parentError === null) assert.equal(rec.parentError, null);
    else assert.equal(rec.parentError, plain[i].parentError! + ERROR);
  }
  // The group that replaces a cluster grows by the same length: which cluster replaces which
  // does not move, only the distance both are certified to.
  const { level } = scene(QUANTIZATION);
  const groups = structureIndex(level.structure, 3, ERROR)!;
  assert.deepEqual([...groups.error], [level.structure.groups[0].error + ERROR]);
});

test('a cluster box grows by the same length, and so does the node that encloses it', () => {
  const quantized = scene(QUANTIZATION).collected.allPages[0];
  assert.deepEqual(quantized.min, [-1 - ERROR, -1 - ERROR, -ERROR]);
  assert.deepEqual(quantized.max, [1 + ERROR, 1 + ERROR, ERROR]);
  const nodes = [-1, -1, 0, 1, 1, 0, 0, 0, 0, 1, 0.5, 0, 0, 0, 2];
  const widened = cullingNodes({ stride: 15, count: 1, nodes }, 2, ERROR)!;
  assert.deepEqual([...widened.nodes.subarray(0, 6)], [-1.25, -1.25, -0.25, 1.25, 1.25, 0.25]);
  assert.equal(widened.nodes[10], 0.5 + ERROR);
});

test('a cache whose pages carry no grid certifies exactly what it did before', () => {
  assert.equal(quantizationErrorOf({ quantization: null }), 0);
  assert.equal(
    quantizationErrorOf({ quantization: { ...QUANTIZATION, maxPositionError: null } }),
    0,
  );
  const plain = scene(null).collected.allPages[0];
  assert.equal(plain.lodError, 0);
  assert.deepEqual(plain.min, [-1, -1, 0]);
});
