import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterErrorPixels,
  maxStretch,
  dot,
  norm,
  quadricFromPlanes,
  quadricEnergy,
  solvePivoted,
  quadricCandidate,
  projectedPoint,
  projectedErrorBound,
  lodScore,
  requiredBits,
  simplicialLink,
  linkCondition,
  coneRejects,
  pointTriangleDistance,
  sphereUnion,
  aabbOutsidePlane,
  exclusiveScan,
  compact,
  hizReduceCeil,
  hizBuildPyramid,
  hizFootprintFar,
  hizOccluded,
  HIZ_BACKGROUND,
  edge,
  barycentric,
  perspectiveAttribute,
  perspectiveDerivative,
  quantize,
  signNotZero,
  octEncode,
  octDecode,
  crc,
  packedWeights,
  validRange,
  signedFold,
  signedUnfold,
  sphereRatioBounds,
  depthEncode,
  depthDecode,
  dispatchRange,
  affineRectangleRange,
  composeBitPatches,
  barycentricDistanceSquared,
  bezierCubic,
  sggxDiagonal,
  transmittance,
  packDrawIndirect,
} from './index.ts';

function createSeededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

test('qem rejects nonfinite planes and weights', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(() => quadricFromPlanes([[[1, 0, 0, 0], invalid]]));
    assert.throws(() => quadricFromPlanes([[[1, 0, 0, invalid], 1]]));
  }
});

test('qem rejects wrong dimensions', () => {
  for (const plane of [[1, 0, 0], [1, 0, 0, 0, 0]]) {
    assert.throws(() => quadricFromPlanes([[plane, 1]]));
  }
  assert.throws(() => dot([1, 2], [1]));
});

test('tetrahedron common vertices are not the full link', () => {
  const triangles: [number, number, number][] = [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ];
  const left = simplicialLink(triangles, new Set([0]));
  const right = simplicialLink(triangles, new Set([1]));
  const intersection = new Set([...left].filter(x => right.has(x)));
  const commonVertices = new Set([...intersection].filter(s => !s.includes(',')));

  assert.deepEqual(commonVertices, simplicialLink(triangles, new Set([0, 1])));
  assert.ok(intersection.has('2,3'));
  assert.equal(linkCondition(triangles, 0, 1), false);

  const after = triangles.map(face => face.map(v => (v === 1 ? 0 : v)) as [number, number, number]);
  const surviving = after
    .filter(face => new Set(face).size === 3)
    .map(face => [...face].sort((a, b) => a - b).join(','));
  assert.equal(surviving.length, 2);
  assert.equal(new Set(surviving).size, 1);
});

test('link condition accepts an octahedron edge', () => {
  const triangles: [number, number, number][] = [];
  for (const pole of [0, 1]) {
    for (const ring of [[2, 3, 4, 5]]) {
      for (let i = 0; i < 4; i++) {
        triangles.push([pole, ring[i], ring[(i + 1) % 4]]);
      }
    }
  }
  assert.equal(linkCondition(triangles, 0, 2), true);
});

test('orthographic error does not shrink with distance', () => {
  for (const depth of [1, 100, 10000]) {
    const score = lodScore(1, 1, [0, 0, depth], [1, 1, depth + 1], [100, 80], 'orthographic', 0);
    assert.equal(score, 100);
  }
});

test('lod error includes instance scale', () => {
  for (const projection of ['orthographic', 'perspective'] as const) {
    const params1 = [0.01, 10, [0, 0, 100], [1, 1, 101], [100, 80], projection, 0.1] as const;
    const params2 = [0.01, 1, [0, 0, 100], [1, 1, 101], [100, 80], projection, 0.1] as const;
    assert.ok(Math.abs(lodScore(...params1) - 10 * lodScore(...params2)) < 1e-9);
  }
});

test('lod projection and near contract', () => {
  assert.throws(() => lodScore(1, 1, [0, 0, 1], [1, 1, 2], [100, 100], 'perspective', 0));
  assert.throws(() => lodScore(1, 1, [0, 0, 1], [1, 1, 2], [100, 100], 'unknown' as any, 0.1));
  assert.throws(() => lodScore(1, 1, [0, 0, 1], [1, 1, 2], [100, 100], 'orthographic', -1));
});

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

test('integer width boundaries', () => {
  const cases: [number | bigint, number | bigint, number][] = [
    [0, 0, 0],
    [-4, -1, 2],
    [0, 2 ** 31 - 1, 31],
    [0, 2 ** 31, 32],
    [0, 2 ** 31 + 1, 32],
    [0, 2 ** 32 - 1, 32],
    [0, 2 ** 32, 33],
    [0n, 2n ** 32n, 33],
    [0n, 2n ** 63n, 64],
  ];
  for (const [low, high, count] of cases) {
    assert.equal(requiredBits(low, high), count);
    assert.ok(BigInt(high) - BigInt(low) <= 2n ** BigInt(count) - 1n);
  }
});

test('point triangle interior edge and degeneracy', () => {
  const triangle: readonly [readonly number[], readonly number[], readonly number[]] = [
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
  ];
  assert.equal(pointTriangleDistance([0.5, 0.5, 3], triangle), 3);
  assert.ok(Math.abs(pointTriangleDistance([2, 2, 0], triangle) - Math.sqrt(2)) < 1e-12);
  assert.equal(pointTriangleDistance([1, 1, 0], [[0, 0, 0], [2, 0, 0], [2, 0, 0]]), 1);
  assert.equal(pointTriangleDistance([0, 0, 3], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]), 3);
});

test('surface samples need a covering radius', () => {
  const triangle = [
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
  ] as const;
  const moved = triangle.map(p => [p[0], p[1], 1] as const);
  const sampleMax = Math.max(...triangle.map(p => pointTriangleDistance(p, moved as any)));
  const diameter = Math.sqrt(8);
  assert.equal(sampleMax, 1);
  for (const [u, v] of [
    [0.1, 0.2],
    [0.25, 0.5],
    [0.7, 0.1],
  ]) {
    assert.ok(pointTriangleDistance([2 * u, 2 * v, 0], moved as any) <= sampleMax + diameter);
  }
});

test('qem known intersection', () => {
  const quadric = quadricFromPlanes([
    [[1, 0, 0, -1], 1],
    [[0, 1, 0, -2], 1],
    [[0, 0, 1, -3], 1],
  ]);
  const optimum = quadricCandidate(quadric, [0, 0, 0], [4, 4, 4]);
  assert.deepEqual(optimum, [1, 2, 3]);
  assert.ok(Math.abs(quadricEnergy(quadric, optimum)) < 1e-12);
});

test('qem singular fallback', () => {
  const quadric = quadricFromPlanes([[[0, 0, 1, 0], 1]]);
  assert.deepEqual(quadricCandidate(quadric, [0, 0, 1], [1, 1, -1]), [0.5, 0.5, 0.0]);
});

test('qem energy matches plane distance', () => {
  const quadric = quadricFromPlanes([[[0.6, 0.8, 0, -2], 3]]);
  const point = [4, 5, 6];
  assert.ok(Math.abs(quadricEnergy(quadric, point) - 3 * (0.6 * 4 + 0.8 * 5 - 2) ** 2) < 1e-12);
});

test('qem rejects non normalized input', () => {
  assert.throws(() => quadricFromPlanes([[[2, 0, 0, 0], 1]]));
});

test('max error is not cumulative bound', () => {
  const firstDisplacement = 0.001;
  const secondDisplacement = 0.001;
  assert.ok(firstDisplacement + secondDisplacement > Math.max(firstDisplacement, secondDisplacement));
});

test('focal example', () => {
  const focal = 1080 / (2 * Math.tan(Math.PI / 6));
  assert.ok(Math.abs((focal * 0.01) / 10 - 0.935307436) < 1e-8);
});

test('projected bound random pairs', () => {
  const rand = createSeededRandom(20260911);
  const minimum = [-8, -5, 2];
  const maximum = [7, 9, 30];
  const focal = [900, 1100];
  for (let i = 0; i < 2000; i++) {
    const first = minimum.map((min, idx) => rand() * (maximum[idx] - min) + min);
    const second = minimum.map((min, idx) => rand() * (maximum[idx] - min) + min);
    const error = norm(second.map((val, idx) => val - first[idx]));
    const bound = projectedErrorBound(error, minimum, maximum, focal);
    const projectedFirst = projectedPoint(first, focal);
    const projectedSecond = projectedPoint(second, focal);
    const observed = norm(projectedSecond.map((val, idx) => val - projectedFirst[idx]));
    assert.ok(observed <= bound + 1e-9);
  }
});

test('radial distance underestimates off axis', () => {
  const first = [10, 0, 10];
  const second = [10, 0, 10.01];
  const focal = [1000, 1000];
  const observed = Math.abs(projectedPoint(first, focal)[0] - projectedPoint(second, focal)[0]);
  const radialApproximation = (1000 * 0.01) / norm(first);
  assert.ok(observed > radialApproximation);
});

test('near plane requests refinement', () => {
  assert.equal(projectedErrorBound(0.01, [-1, -1, 0], [1, 1, 3], [900, 900]), Infinity);
});

test('nested bounds project monotonically', () => {
  const child = projectedErrorBound(0.01, [-1, -1, 10], [1, 1, 12], [900, 900]);
  const parent = projectedErrorBound(0.02, [-3, -3, 8], [3, 3, 15], [900, 900]);
  assert.ok(parent >= child);
});

test('shear max column not spectral bound', () => {
  const direction = [1 / Math.sqrt(2), 1 / Math.sqrt(2), 0];
  const transformed = [direction[0] + direction[1], direction[1], 0];
  const maximumColumn = Math.sqrt(2);
  assert.ok(norm(transformed) > maximumColumn);
});

test('sphere union contains both', () => {
  const [center, radius] = sphereUnion([0, 0, 0], 1, [4, 0, 0], 1);
  assert.deepEqual(center, [2, 0, 0]);
  assert.equal(radius, 3);
  assert.ok(norm(center) + 1 <= radius);
});

test('sphere union coincident', () => {
  const [center, radius] = sphereUnion([0, 0, 0], 1, [0, 0, 0], 2);
  assert.deepEqual(center, [0, 0, 0]);
  assert.equal(radius, 2);
});

test('aabb plane equals corner maximum', () => {
  const center = [1, 2, 3];
  const extent = [0.5, 0.25, 2];
  const normal = [-3, 1, 2];
  const offset = -11;
  const corners: number[][] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push([center[0] + sx * extent[0], center[1] + sy * extent[1], center[2] + sz * extent[2]]);
      }
    }
  }
  const expected = Math.max(...corners.map(c => dot(normal, c) + offset)) < 0;
  assert.equal(aabbOutsidePlane(center, extent, normal, offset), expected);
});

test('tangent aabb is kept', () => {
  assert.equal(aabbOutsidePlane([-1, 0, 0], [1, 1, 1], [1, 0, 0], 0), false);
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
      values.filter((_, i) => flags[i] === 1)
    );
  }
});

test('hiz background prevents false rejection', () => {
  assert.deepEqual(hizReduceCeil([[0.2, 0.3], [0.4, 1.0]]), [[1.0]]);
  assert.deepEqual(hizReduceCeil([[0.8, 0.7], [0.6, 0]], true), [[0]]);
});

test('hiz odd dimension keeps last column', () => {
  const level = hizReduceCeil([[0.2, 0.3, 1], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]]);
  assert.deepEqual(level, [[0.5, 1], [0.8, 0.9]]);
  assert.deepEqual(hizReduceCeil(level), [[1]]);
});

test('hiz pyramid reduces by ceil 2x2 max until a single texel', () => {
  const depth = [[0.2, 0.3, 1], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]];
  const pyramid = hizBuildPyramid(depth);
  assert.equal(HIZ_BACKGROUND, 1);
  assert.deepEqual(pyramid[0], depth);
  assert.deepEqual(pyramid[1], [[0.5, 1], [0.8, 0.9]]);
  assert.deepEqual(pyramid[2], [[1]]);
});

test('hiz footprint of a background hole cannot hide a nearer bound', () => {
  const pyramid = hizBuildPyramid([[0.2, 0.3], [0.4, 1.0]]);
  assert.equal(hizFootprintFar(pyramid, 0, 0, 2, 2, 0), 1);
  assert.equal(hizFootprintFar(pyramid, 0, 0, 2, 2, 1), 1);
  assert.equal(hizOccluded(0.8, hizFootprintFar(pyramid, 0, 0, 2, 2, 1)), false);
});

test('hiz occludes only when the nearest bound is strictly behind every covered far depth', () => {
  const pyramid = hizBuildPyramid([[0.2, 0.3], [0.4, 0.5]]);
  assert.equal(hizFootprintFar(pyramid, 0, 0, 2, 2, 0), 0.5);
  assert.equal(hizOccluded(0.8, 0.5), true);
  assert.equal(hizOccluded(0.5, 0.5), false);
  assert.equal(hizOccluded(0.4, 0.5), false);
  assert.equal(hizOccluded(0.8, 0.5, 0.3), false);
});

test('hiz empty or out of range footprint does not occlude', () => {
  const pyramid = hizBuildPyramid([[0.2, 0.3], [0.4, 0.5]]);
  assert.equal(hizOccluded(0.9, hizFootprintFar(pyramid, 2, 2, 2, 3, 0)), false);
  assert.equal(hizOccluded(0.9, hizFootprintFar(pyramid, 0, 0, 0, 2, 0)), false);
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

test('perspective attribute example', () => {
  assert.ok(Math.abs(perspectiveAttribute([1 / 3, 1 / 3, 1 / 3], [1, 2, 4], [0, 1, 0]) - 2 / 7) < 1e-12);
});

test('analytic derivative matches same triangle finite difference', () => {
  const weights = [0.3, 0.3, 0.4];
  const derivative = [-0.2, 0.2, 0];
  const clipW = [1, 2, 4];
  const attributes = [0.1, 0.8, 0.2];
  const epsilon = 1e-5;
  const after = perspectiveAttribute(
    weights.map((w, i) => w + epsilon * derivative[i]),
    clipW,
    attributes
  );
  const before = perspectiveAttribute(
    weights.map((w, i) => w - epsilon * derivative[i]),
    clipW,
    attributes
  );
  const analytical = perspectiveDerivative(weights, derivative, clipW, attributes);
  const numerical = (after - before) / (2 * epsilon);
  assert.ok(Math.abs(analytical - numerical) < 1e-9);
});

test('quantization negative tie is explicit', () => {
  assert.deepEqual(quantize(-0.5, 1), [0, 0]);
  assert.deepEqual(quantize(0.5, 1), [1, 1]);
});

test('quantization distance bound', () => {
  const rand = createSeededRandom(422);
  const step = 0.001;
  for (let i = 0; i < 1000; i++) {
    const point = [rand() * 20 - 10, rand() * 20 - 10, rand() * 20 - 10];
    const decoded = point.map(val => quantize(val, step)[1]);
    const diff = norm(point.map((val, idx) => val - decoded[idx]));
    assert.ok(diff <= (Math.sqrt(3) * step) / 2 + 1e-12);
  }
});

test('octahedral roundtrip', () => {
  const rand = createSeededRandom(234);
  const normals: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (let i = 0; i < 1000; i++) {
    normals.push([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]);
  }
  for (const normal of normals) {
    const nNorm = norm(normal);
    const expected = normal.map(v => v / nNorm);
    const reconstructed = octDecode(octEncode(normal));
    const diff = norm(expected.map((v, idx) => v - reconstructed[idx]));
    assert.ok(diff < 1e-12);
  }
});

test('amdahl example', () => {
  assert.ok(Math.abs(1 / (0.9 + 0.1 / 4) - 1.081081081081081) < 1e-12);
});

test('crc check value', () => {
  const data = new TextEncoder().encode('123456789');
  assert.equal(crc(data), 0xcbf43926);
  assert.equal(crc(new Uint8Array(0)), 0);
});

test('weight integer sum', () => {
  assert.deepEqual(packedWeights([0.2, 0.3, 0.5], 255), [51, 77, 127]);
  assert.deepEqual(packedWeights([1, 1, 1], 4), [2, 1, 1]);
});

test('weight random sum', () => {
  const rand = createSeededRandom(715);
  for (let count = 1; count < 20; count++) {
    const weights = Array.from({ length: count }, () => rand());
    const result = packedWeights(weights, 255);
    assert.equal(result.reduce((a, b) => a + b, 0), 255);
    assert.ok(result.every(v => v >= 0 && v <= 255));
  }
});

test('weight rejects invalid input', () => {
  for (const weights of [[], [0, 0], [-1, 2], [NaN], [Infinity]]) {
    assert.throws(() => packedWeights(weights, 255));
  }
});

test('section ranges', () => {
  assert.equal(validRange(10, 90, 100), true);
  assert.equal(validRange(100, 0, 100), true);
  assert.equal(validRange(10, 91, 100), false);
  assert.equal(validRange(-1, 1, 100), false);
  assert.equal(validRange(2n ** 64n - 1n, 2n, 2n ** 64n), false);
});

test('signed integer roundtrip', () => {
  for (let value = -1000; value <= 1000; value++) {
    assert.equal(signedUnfold(signedFold(value)), value);
  }
});

test('weight budget rejected', () => {
  for (const maximum of [0, -1, 1.5]) {
    assert.throws(() => packedWeights([1], maximum));
  }
});

test('sphere bounds contain sampled surface', () => {
  const rand = createSeededRandom(650);
  for (const [center, radius] of [
    [[0, 0, 3], 1],
    [[13, -7, 4], 2],
    [[-8, 2, 10], 0.1],
  ] as const) {
    const bounds = sphereRatioBounds(center, radius, 0.1);
    for (let i = 0; i < 1500; i++) {
      const z = rand() * 2 - 1;
      const phi = rand() * 2 * Math.PI;
      const point = [
        center[0] + radius * Math.sqrt(1 - z * z) * Math.cos(phi),
        center[1] + radius * Math.sqrt(1 - z * z) * Math.sin(phi),
        center[2] + radius * z,
      ];
      for (let axis = 0; axis < 2; axis++) {
        assert.ok(bounds[axis][0] - 1e-12 <= point[axis] / point[2]);
        assert.ok(point[axis] / point[2] <= bounds[axis][1] + 1e-12);
      }
    }
  }
});

test('sphere bound ray is tangent', () => {
  for (const [x, z, radius] of [
    [2, 5, 1],
    [-13, 3, 2],
    [0, 8, 4],
  ]) {
    const bounds = sphereRatioBounds([x, 0, z], radius, 0.1);
    for (const slope of bounds[0]) {
      const distanceToLine = Math.abs(x - slope * z) / Math.sqrt(1 + slope * slope);
      assert.ok(Math.abs(distanceToLine - radius) < 1e-12);
    }
  }
});

test('sphere zero and clipped domain', () => {
  assert.deepEqual(sphereRatioBounds([2, 4, 8], 0, 1), [
    [0.25, 0.25],
    [0.5, 0.5],
  ]);
  for (const [center, radius, near] of [
    [[0, 0, 2], 1, 1],
    [[0, 0, 0], 1, 0.1],
    [[0, 0, 3], -1, 1],
    [[NaN, 0, 3], 1, 1],
    [[1e200, 0, 1e200], 0, 1],
  ] as const) {
    assert.throws(() => sphereRatioBounds(center, radius, near));
  }
});

test('finite depth endpoints and roundtrip', () => {
  for (const [near, far] of [
    [0.1, 100],
    [1, 10000],
    [2, 3],
  ]) {
    for (const reverse of [false, true]) {
      assert.ok(Math.abs(depthEncode(near, near, far, reverse) - (reverse ? 1 : 0)) < 1e-12);
      assert.ok(Math.abs(depthEncode(far, near, far, reverse) - (reverse ? 0 : 1)) < 1e-12);
      for (const distance of [near, Math.sqrt(near * far), far]) {
        const q = depthEncode(distance, near, far, reverse);
        const decoded = depthDecode(q, near, far, reverse);
        assert.ok(Math.abs(decoded - distance) / distance < 1e-10);
      }
    }
  }
});

test('infinite depth and background', () => {
  for (const reverse of [false, true]) {
    for (const distance of [0.1, 1, 1000]) {
      const q = depthEncode(distance, 0.1, undefined, reverse);
      const decoded = depthDecode(q, 0.1, undefined, reverse);
      assert.ok(Math.abs(decoded - distance) / distance < 1e-10);
    }
    assert.equal(depthDecode(reverse ? 0 : 1, 0.1, undefined, reverse), Infinity);
  }
});

test('depth derivative matches difference', () => {
  const near = 1;
  const far = 100;
  const distance = 7;
  const q = depthEncode(distance, near, far);
  const step = 1e-7;
  const numerical = (depthDecode(q + step, near, far) - depthDecode(q - step, near, far)) / (2 * step);
  const analytical = (distance * distance * (far - near)) / (near * far);
  assert.ok(Math.abs(numerical - analytical) < 1e-6);
});

test('reversed depth preserves small values', () => {
  assert.ok(Math.abs(depthDecode(1, 1, 1e20) / 1e20 - 1) < 1e-12);
  assert.ok(Math.abs(depthEncode(1e16, 0.1, undefined, true) / 1e-17 - 1) < 1e-12);
  assert.ok(Math.abs(depthDecode(1e-17, 0.1, undefined, true) / 1e16 - 1) < 1e-12);
  for (const far of [1e18, 1e30]) {
    const distance = 1e16;
    const q = depthEncode(distance, 0.1, far, true);
    assert.ok(Math.abs(depthDecode(q, 0.1, far, true) / distance - 1) < 1e-12);
  }
});

test('depth invalid domain', () => {
  for (const [q, near, far] of [
    [NaN, 1, 2],
    [-0.1, 1, 2],
    [0.5, 0, 2],
    [0.5, 2, 1],
  ]) {
    assert.throws(() => depthDecode(q, near, far));
  }
});

test('dispatch ranges cover once', () => {
  for (const count of [0, 1, 7, 64, 65, 1001]) {
    for (const workers of [1, 3, 16, 128]) {
      const visited: number[] = [];
      for (let w = 0; w < workers; w++) {
        const [start, end] = dispatchRange(count, workers, w);
        for (let i = Number(start); i < Number(end); i++) {
          visited.push(i);
        }
      }
      const expected = Array.from({ length: count }, (_, i) => i);
      assert.deepEqual(visited, expected);
    }
  }
});

test('dispatch exact large integer boundaries', () => {
  const count = 2n ** 64n - 1n;
  const workers = 7;
  const intervals: [bigint, bigint][] = [];
  for (let i = 0; i < workers; i++) {
    intervals.push(dispatchRange(count, workers, i));
  }
  assert.equal(intervals[0][0], 0n);
  assert.equal(intervals[intervals.length - 1][1], count);
  for (let i = 0; i < intervals.length - 1; i++) {
    assert.equal(intervals[i][1], intervals[i + 1][0]);
  }
  const lengths = intervals.map(([a, b]) => b - a);
  let maxLen = lengths[0];
  let minLen = lengths[0];
  for (const len of lengths) {
    if (len > maxLen) maxLen = len;
    if (len < minLen) minLen = len;
  }
  assert.ok(maxLen - minLen <= 1n);
});

test('dispatch rejects invalid ranges', () => {
  for (const values of [
    [-1, 1, 0],
    [3, 0, 0],
    [3, 2, 2],
    [3, 2, -1],
    [3.5, 2, 0],
  ] as const) {
    assert.throws(() => dispatchRange(values[0] as any, values[1], values[2]));
  }
});

test('affine rectangle extrema match corners', () => {
  const rand = createSeededRandom(777);
  for (let i = 0; i < 1000; i++) {
    const [a, b, c, x, y] = Array.from({ length: 5 }, () => rand() * 18 - 9);
    const [hx, hy] = [rand(), rand()];
    const corners: number[] = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        corners.push(a * (x + sx * hx) + b * (y + sy * hy) + c);
      }
    }
    const [low, high] = affineRectangleRange([a, b, c], [x, y], [hx, hy]);
    assert.ok(Math.abs(low - Math.min(...corners)) < 1e-11);
    assert.ok(Math.abs(high - Math.max(...corners)) < 1e-11);
  }
});

test('outer coverage does not prove inner coverage', () => {
  for (const coefficients of [[1, 0, 0], [0, 1, 0], [-1, -1, 0.1]] as const) {
    const [low, high] = affineRectangleRange(coefficients, [0, 0], [0.5, 0.5]);
    assert.ok(high >= 0);
    assert.ok(low < 0);
  }
});

test('bit patch composition exhaustive two bits', () => {
  for (let a1 = 0; a1 < 4; a1++) {
    for (let o1 = 0; o1 < 4; o1++) {
      for (let a2 = 0; a2 < 4; a2++) {
        for (let o2 = 0; o2 < 4; o2++) {
          const [a, o] = composeBitPatches([a1, o1], [a2, o2]);
          for (let val = 0; val < 4; val++) {
            assert.equal((val & a) | o, (((val & a1) | o1) & a2) | o2);
          }
        }
      }
    }
  }
});

test('bit patch order matters', () => {
  const setBit: [number, number] = [3, 1];
  const clearBit: [number, number] = [2, 0];
  assert.notDeepEqual(composeBitPatches(setBit, clearBit), composeBitPatches(clearBit, setBit));
});

test('barycentric distance matches cartesian', () => {
  const verticesBase: readonly [readonly number[], readonly number[], readonly number[]] = [
    [1e9, 0, 0],
    [1e9 + 1, 0, 0],
    [1e9, 1, 0],
  ];
  assert.equal(barycentricDistanceSquared(verticesBase, [1 + 5e-10, 0, 0], [1, 0, 0]), 0);

  const rand = createSeededRandom(322);
  for (let iter = 0; iter < 500; iter++) {
    const vertices = Array.from({ length: 3 }, () => [
      rand() * 20 - 10,
      rand() * 20 - 10,
      rand() * 20 - 10,
    ]) as [number[], number[], number[]];
    let first = [rand(), rand(), rand()];
    let second = [rand(), rand(), rand()];
    const sum1 = first.reduce((a, b) => a + b, 0);
    const sum2 = second.reduce((a, b) => a + b, 0);
    first = first.map(v => v / sum1);
    second = second.map(v => v / sum2);

    const p = [0, 1, 2].map(k => first.reduce((acc, w, i) => acc + w * vertices[i][k], 0));
    const q = [0, 1, 2].map(k => second.reduce((acc, w, i) => acc + w * vertices[i][k], 0));

    const expected = p.reduce((acc, val, i) => acc + (val - q[i]) ** 2, 0);
    const observed = barycentricDistanceSquared(vertices, first, second);
    assert.ok(Math.abs(observed - expected) < 1e-10);
  }
});

test('weight truncation bound under divergent poses', () => {
  const rand = createSeededRandom(181);
  for (let iter = 0; iter < 500; iter++) {
    let weights = Array.from({ length: 5 }, () => rand());
    const sumW = weights.reduce((a, b) => a + b, 0);
    weights = weights.map(w => w / sumW);
    const positions = weights.map(() => [rand() * 20 - 10, rand() * 20 - 10, rand() * 20 - 10]);
    const removed = weights[3] + weights[4];
    const original = [0, 1, 2].map(k => weights.reduce((acc, w, i) => acc + w * positions[i][k], 0));
    const reduced = [0, 1, 2].map(k =>
      [0, 1, 2].reduce((acc, i) => acc + (weights[i] * positions[i][k]) / (1 - removed), 0)
    );
    let diameter = 0;
    for (const p of positions) {
      for (const q of positions) {
        diameter = Math.max(diameter, norm(p.map((v, i) => v - q[i])));
      }
    }
    const diffNorm = norm(original.map((v, i) => v - reduced[i]));
    assert.ok(diffNorm <= removed * diameter + 1e-12);
  }
});

test('bezier endpoints and de casteljau', () => {
  const points = [
    [0, 0, 0],
    [3, -1, 2],
    [-2, 4, 5],
    [1, 0, 0],
  ] as const;
  assert.deepEqual(bezierCubic(points, 0), points[0]);
  assert.deepEqual(bezierCubic(points, 1), points[3]);
  for (let step = 0; step <= 100; step++) {
    const t = step / 100;
    let layer: number[][] = points.map(p => [...p]);
    for (let round = 0; round < 3; round++) {
      const nextLayer: number[][] = [];
      for (let i = 0; i < layer.length - 1; i++) {
        nextLayer.push([0, 1, 2].map(k => (1 - t) * layer[i][k] + t * layer[i + 1][k]));
      }
      layer = nextLayer;
    }
    const evalPoint = bezierCubic(points, t);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(evalPoint[k] - layer[0][k]) < 1e-13);
    }
  }
});

test('bezier uniform parameter is not uniform length', () => {
  const points = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [8, 0, 0],
  ] as const;
  assert.deepEqual(bezierCubic(points, 0.5), [1, 0, 0]);
});

test('sggx isotropic reference', () => {
  const [sigma, distribution, pdf] = sggxDiagonal([1, 1, 1], [0, 0, 1], [0, 0, 1]);
  assert.equal(sigma, 1);
  assert.ok(Math.abs(distribution - 1 / Math.PI) < 1e-12);
  assert.equal(pdf, distribution);
});

test('sggx visible pdf quadrature', () => {
  const nz = 160;
  const nphi = 160;
  let integral = 0;
  for (let iz = 0; iz < nz; iz++) {
    const z = -1 + ((iz + 0.5) * 2) / nz;
    for (let iphi = 0; iphi < nphi; iphi++) {
      const phi = ((iphi + 0.5) * 2 * Math.PI) / nphi;
      const normal = [Math.sqrt(1 - z * z) * Math.cos(phi), Math.sqrt(1 - z * z) * Math.sin(phi), z];
      integral += sggxDiagonal([0.5, 1, 2], normal, [0, 0, 1])[2];
    }
  }
  assert.ok(Math.abs((integral * 4 * Math.PI) / (nz * nphi) - 1) < 0.002);
});

test('sggx rejects singular matrix and nonunit directions', () => {
  for (const [diagonal, direction] of [
    [
      [1, 1, 0],
      [0, 0, 1],
    ],
    [
      [1, 1, -1],
      [0, 0, 1],
    ],
    [
      [1, 1, 1],
      [0, 0, 2],
    ],
    [
      [1e200, 1e200, 1e200],
      [0, 0, 1],
    ],
  ] as const) {
    assert.throws(() => sggxDiagonal(diagonal, direction, [0, 0, 1]));
  }
});

test('transmittance segmentation invariance', () => {
  const expected = transmittance(2, 0.5);
  assert.ok(Math.abs(expected - Math.exp(-1)) < 1e-12);
  for (const count of [1, 2, 32, 100]) {
    assert.ok(Math.abs(transmittance(2, 0.5 / count) ** count - expected) < 1e-13);
  }
  assert.equal(transmittance(0, 5), 1);
});

test('transmittance rejects invalid domain', () => {
  for (const [extinction, length] of [
    [-1, 2],
    [2, -1],
    [NaN, 1],
    [1, Infinity],
  ]) {
    assert.throws(() => transmittance(extinction, length));
  }
});

test('perspective uniform object split is not screen uniform', () => {
  const start = 0 / 1;
  const middle = 1 / 1.5;
  const end = 2 / 2;
  assert.equal(Math.ceil((end - start) / 0.5), 2);
  assert.ok(middle - start > 0.5);
});

test('the stretch of a linear map is its largest singular value, not its Frobenius norm', () => {
  const rotation = new Array(16).fill(0);
  const angle = 0.7, c = Math.cos(angle), s = Math.sin(angle);
  rotation[0] = c; rotation[1] = s; rotation[4] = -s; rotation[5] = c; rotation[10] = 1; rotation[15] = 1;
  assert.ok(Math.abs(maxStretch(rotation) - 1) < 1e-12, 'a rotation stretches nothing');
  const uniform = rotation.map((value, index) => index < 12 ? value * 3 : value);
  uniform[15] = 1;
  assert.ok(Math.abs(maxStretch(uniform) - 3) < 1e-12, 'a uniform scale reports its factor');
  const anisotropic = new Array(16).fill(0);
  anisotropic[0] = 2; anisotropic[5] = 5; anisotropic[10] = 0.5; anisotropic[15] = 1;
  assert.ok(Math.abs(maxStretch(anisotropic) - 5) < 1e-12, 'a diagonal map reports its largest axis');
  const identity = new Array(16).fill(0);
  identity[0] = identity[5] = identity[10] = identity[15] = 1;
  assert.equal(maxStretch(identity), 1);
  assert.throws(() => maxStretch([1, 2, 3]), /Matrice invalide/);
});

test('a cluster error projects as error x stretch x focal over the distance to its sphere', () => {
  // Sphere of radius 1 centred 10 in front: the nearest point is 9 away.
  assert.ok(Math.abs(clusterErrorPixels(0.5, 1, 0, 0, 10, 1, 600, 0.1) - (0.5 * 600 / 9)) < 1e-9);
  assert.ok(Math.abs(clusterErrorPixels(0.5, 2, 0, 0, 10, 0, 600, 0.1) - (0.5 * 2 * 600 / 10)) < 1e-9);
  assert.equal(clusterErrorPixels(0, 1, 0, 0, 0.05, 1, 600, 0.1), 0, 'exact geometry never needs refining');
  assert.equal(clusterErrorPixels(Infinity, 1, 0, 0, 10, 1, 600, 0.1), Infinity, 'a cluster with no replacement always wins');
  assert.equal(clusterErrorPixels(0.5, 1, 0, 0, 1, 1, 600, 0.1), Infinity, 'a sphere reaching the near plane refines');
  assert.throws(() => clusterErrorPixels(-1, 1, 0, 0, 10, 1, 600, 0.1), /invalides/);
  // Monotone in the error and in an enclosing sphere, which is what keeps one cut per chain.
  const small = clusterErrorPixels(0.5, 1, 0, 0, 10, 1, 600, 0.1);
  assert.ok(clusterErrorPixels(0.6, 1, 0, 0, 10, 1, 600, 0.1) > small);
  assert.ok(clusterErrorPixels(0.5, 1, 0, 0, 10, 2, 600, 0.1) > small);
});
