import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterErrorPixels,
  dot,
  coneRejects,
  exclusiveScan,
  compact,
  edge,
  barycentric,
  packDrawIndirect,
  maxStretch,
} from './index.ts';

function createSeededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

test('wide cone must not reject a visible normal', () => {
  const angle = (2 * Math.PI) / 3;
  const normal = [Math.sqrt(3) / 2, 0, -0.5];
  assert.ok(dot(normal, [0, 0, -1]) > 0);
  assert.ok(-1 < -Math.sin(angle));
  assert.equal(coneRejects(-1, angle), false);
});

test('cone tangency and perspective spread are kept', () => {
  assert.equal(coneRejects(-1, Math.PI / 6), true);
  assert.equal(coneRejects(-Math.sin(Math.PI / 6), Math.PI / 6), false);
  assert.equal(coneRejects(-1, Math.PI / 3, Math.PI / 6), false);
});

test('max error is not cumulative bound', () => {
  const firstDisplacement = 0.001;
  const secondDisplacement = 0.001;
  assert.ok(
    firstDisplacement + secondDisplacement > Math.max(firstDisplacement, secondDisplacement),
  );
});

test('focal example', () => {
  const focal = 1080 / (2 * Math.tan(Math.PI / 6));
  assert.ok(Math.abs((focal * 0.01) / 10 - 0.935307436) < 1e-8);
});

test('unique cut and threshold equality', () => {
  const scores = [8, 2, 0];
  const parents = [Infinity, 8, 2];
  for (const threshold of [0, 1, 2, 3, 8, 10]) {
    const selected = scores.map((score, i) => score <= threshold && threshold < parents[i]);
    assert.equal(selected.filter(Boolean).length, 1);
  }
});

test('scan example', () => {
  const [offsets, total] = exclusiveScan([1, 0, 1, 1, 0]);
  assert.deepEqual(offsets, [0, 1, 1, 2, 3]);
  assert.equal(total, 3);
});

test('compaction empty and partial', () => {
  assert.deepEqual(compact([], []), []);
  assert.deepEqual(compact(['a', 'b', 'c'], [1, 0, 1]), ['a', 'c']);
});

test('compaction matches filter', () => {
  const rand = createSeededRandom(121);
  for (const size of [1, 31, 32, 33, 63, 64, 65, 129]) {
    const flags = Array.from({ length: size }, () => (rand() < 0.5 ? 0 : 1));
    const values = Array.from({ length: size }, (_, i) => i);
    assert.deepEqual(
      compact(values, flags),
      values.filter((_, i) => flags[i] === 1),
    );
  }
});

test('indirect base vertex signed', () => {
  const buffer = new ArrayBuffer(20);
  const view = new DataView(buffer);
  view.setUint32(0, 3, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, 0, true);
  view.setInt32(12, -7, true);
  view.setUint32(16, 0, true);
  assert.equal(buffer.byteLength, 20);
  assert.equal(view.getInt32(12, true), -7);
});

test('non-indexed drawIndirect is four u32 words', () => {
  const words = packDrawIndirect(768, 17);
  assert.equal(words.length, 4);
  assert.equal(words[0], 768);
  assert.equal(words[1], 17);
  assert.equal(words[2], 0);
  assert.equal(words[3], 0);
  assert.equal(words.byteLength, 16);
});

test('drawIndirect packer rejects non-integers and negatives', () => {
  assert.throws(() => packDrawIndirect(1.5, 1));
  assert.throws(() => packDrawIndirect(-1, 1));
  assert.throws(() => packDrawIndirect(1, 0xffffffff + 1));
});

test('barycentric vertex and center', () => {
  const vertices = [
    [0, 0],
    [3, 0],
    [0, 3],
  ] as const;
  assert.deepEqual(barycentric(vertices, [0, 0]), [1, 0, 0]);
  for (const weight of barycentric(vertices, [1, 1])) {
    assert.ok(Math.abs(weight - 1 / 3) < 1e-12);
  }
});

test('edge increment', () => {
  const first = [2, 3] as const;
  const second = [4, 7] as const;
  const point = [5, 8] as const;
  assert.equal(edge(first, second, [6, 8]) - edge(first, second, point), -4);
  assert.equal(edge(first, second, [5, 9]) - edge(first, second, point), 2);
});

test('amdahl example', () => {
  assert.ok(Math.abs(1 / (0.9 + 0.1 / 4) - 1.081081081081081) < 1e-12);
});

test('perspective uniform object split is not screen uniform', () => {
  const start = 0 / 1;
  const middle = 1 / 1.5;
  const end = 2 / 2;
  assert.equal(Math.ceil((end - start) / 0.5), 2);
  assert.ok(middle - start > 0.5);
});

test('a cluster error projects as error x stretch x focal over the distance to its sphere', () => {
  // Sphere of radius 1 centred 10 in front: the nearest point is 9 away.
  assert.ok(Math.abs(clusterErrorPixels(0.5, 1, 0, 0, 10, 1, 600, 0.1) - (0.5 * 600) / 9) < 1e-9);
  assert.ok(
    Math.abs(clusterErrorPixels(0.5, 2, 0, 0, 10, 0, 600, 0.1) - (0.5 * 2 * 600) / 10) < 1e-9,
  );
  assert.equal(
    clusterErrorPixels(0, 1, 0, 0, 0.05, 1, 600, 0.1),
    0,
    'exact geometry never needs refining',
  );
  assert.equal(
    clusterErrorPixels(Infinity, 1, 0, 0, 10, 1, 600, 0.1),
    Infinity,
    'a cluster with no replacement always wins',
  );
  assert.equal(
    clusterErrorPixels(0.5, 1, 0, 0, 1, 1, 600, 0.1),
    Infinity,
    'a sphere reaching the near plane refines',
  );
  assert.throws(() => clusterErrorPixels(-1, 1, 0, 0, 10, 1, 600, 0.1), /invalides/);
  // Monotone in the error and in an enclosing sphere, which is what keeps one cut per chain.
  const small = clusterErrorPixels(0.5, 1, 0, 0, 10, 1, 600, 0.1);
  assert.ok(clusterErrorPixels(0.6, 1, 0, 0, 10, 1, 600, 0.1) > small);
  assert.ok(clusterErrorPixels(0.5, 1, 0, 0, 10, 2, 600, 0.1) > small);
});

test('maxStretch rejects non-finite matrix elements', () => {
  const withNaN = [NaN, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0];
  assert.throws(() => maxStretch(withNaN), /Matrice invalide/);

  const withInfinityPos = [1, 0, 0, 0, Infinity, 0, 0, 0, 1, 0, 0];
  assert.throws(() => maxStretch(withInfinityPos), /Matrice invalide/);

  const withInfinityNeg = [1, 0, 0, 0, 1, 0, 0, 0, -Infinity, 0, 0];
  assert.throws(() => maxStretch(withInfinityNeg), /Matrice invalide/);
});

test('maxStretch accepts all finite matrix elements and returns finite positive stretch', () => {
  const matrix1 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0];
  const stretch1 = maxStretch(matrix1);
  assert.ok(Number.isFinite(stretch1), 'stretch is finite for standard matrix');
  assert.ok(stretch1 > 0, 'stretch is positive');

  const matrix2 = [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0];
  const stretch2 = maxStretch(matrix2);
  assert.ok(Number.isFinite(stretch2), 'scale 2 stretch is finite');
  assert.ok(stretch2 > 0, 'scale 2 stretch is positive');
});
