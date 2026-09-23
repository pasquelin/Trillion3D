// Spec C4: a cluster's certified error is `lodError + maxPositionError`. An engine draws the
// quantized surface, which stands up to that distance from the one the compiler measured the
// band on, so the two lengths add — in object units, nothing weighted — and the pixel threshold
// then bounds what is drawn. Boxes grow by the same length, on the clusters and on the culling
// nodes that enclose them, so culling never cuts a surface the grid pushed outside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages } from './selection.ts';
import { cullingNodes, quantizationErrorOf } from './helpers.ts';
import { structureIndex } from './structure.ts';
import { dagLevel } from '../../webgpu/pages/testDag.fixture.ts';
import { QUAD_MANIFEST, quadIndices, quadScene } from '../../backend/pagesBackendScenes.fixture.ts';
import type { ClusterManifest, PrimitiveQuantization } from '../../../../sdk-core/src/index.ts';

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

test('a produced cluster certifies its LOD error plus what the grid displaced', () => {
  const plain = scene(null).collected.allPages;
  const quantized = scene(QUANTIZATION).collected.allPages;
  for (const [i, rec] of quantized.entries()) {
    // The two leaves no group produced keep the floor of the ladder; the coarse cluster the
    // group produced, and every replacement band, grow by the displacement.
    const produced = plain[i].source !== null ? ERROR : 0;
    assert.equal(rec.lodError, plain[i].lodError! + produced);
    if (plain[i].parentError === null) assert.equal(rec.parentError, null);
    else assert.equal(rec.parentError, plain[i].parentError! + ERROR);
  }
  // A replacement therefore swaps at the same threshold on both sides of the trade: the band of
  // the group equals the band its output cluster certifies.
  const { level } = scene(QUANTIZATION);
  const groups = structureIndex(level.structure, 3, ERROR)!;
  assert.deepEqual([...groups.error], [level.structure.groups[0].error + ERROR]);
  assert.equal(quantized[2].lodError, groups.error[0]);
  assert.equal(quantized[0].parentError, groups.error[0]);
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
