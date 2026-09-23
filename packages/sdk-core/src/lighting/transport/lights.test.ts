import test from 'node:test';
import assert from 'node:assert/strict';
import type { Vec3, Surface, Scene } from '../scene/experimentScene.ts';
import { createTransport } from './transport.ts';
import { sceneFromSurfaces } from '../../../../../tests/fixtures/lightingTransportScene.ts';
test('three colored emitters combine linearly, relight independently and preserve transport when moved', () => {
  const colors: Vec3[] = [
    [4, 0.2, 0.1],
    [0.1, 2, 0.2],
    [0.2, 0.1, 3],
  ];
  const changedColors: Vec3[] = [
    [0.1, 0.3, 1.2],
    [2.1, 0.1, 0.2],
    [0.4, 0.7, 0.1],
  ];
  const darkness: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  function illuminatedScene(emissions: Vec3[], thirdEmitterX = 2): Scene {
    return sceneFromSurfaces([
      {
        id: 'receiver',
        origin: [0, -3, -3],
        u: [0, 6, 0],
        v: [0, 0, 6],
        albedo: [0.6, 0.5, 0.4],
        emission: [0, 0, 0],
        kind: 'diffuse',
        moving: false,
        columns: 3,
        rows: 3,
      },
      ...emissions.map((emission, index): Surface => ({
        id: `light-${index}`,
        origin: [index === 2 ? thirdEmitterX : 2, -2, index * 2 - 1],
        u: [0, 4, 0],
        v: [0, 0, -2],
        albedo: [0.3, 0.3, 0.3],
        emission,
        kind: 'diffuse',
        moving: true,
        columns: 2,
        rows: 1,
      })),
    ]);
  }
  const options = { raysPerPatch: 64, tolerance: 1e-10 };
  const initial = illuminatedScene(colors);
  const combined = createTransport(initial, options).update(initial, 'rebuild');
  assert.equal(combined.converged, true);
  const individual = colors.map((_, emitter) => {
    const scene = illuminatedScene(
      colors.map((color, index): Vec3 => (index === emitter ? color : [0, 0, 0])),
    );
    return createTransport(scene, options).update(scene, 'rebuild');
  });
  const linearityBound =
    combined.errorBound + individual.reduce((sum, result) => sum + result.errorBound, 0) + 1e-12;
  for (let index = 0; index < combined.radiance.length; index++) {
    const sum = individual.reduce((value, result) => value + result.radiance[index], 0);
    assert.ok(
      Math.abs(combined.radiance[index] - sum) <= linearityBound,
      'multiple sources must sum in linear radiance',
    );
  }
  for (const result of individual) {
    assert.equal(result.converged, true);
    assert.ok(
      result.radiance.subarray(0, 27).some((value) => value > 0.01),
      'each source must illuminate the receiver',
    );
  }
  for (const warmStart of [true, false]) {
    const rebuilt = createTransport(initial, { ...options, warmStart });
    const reused = createTransport(initial, { ...options, warmStart });
    let previousMatrix: Float64Array | undefined;
    let previousRadiance: Float64Array | undefined;
    for (const [emissions, position, moved] of [
      [colors, 2, false],
      [changedColors, 2, false],
      [changedColors, 1.1, true],
      [changedColors, 2.5, true],
    ] as const) {
      const scene = illuminatedScene(emissions, position);
      const full = rebuilt.update(scene, 'rebuild'),
        cached = reused.update(scene, 'reuse');
      const cachedMatrix = reused.snapshot().matrix;
      assert.equal(full.converged, true);
      assert.equal(cached.converged, true);
      assert.deepEqual(
        cachedMatrix,
        rebuilt.snapshot().matrix,
        'moving an emitter must preserve the rebuilt operator',
      );
      for (let index = 0; index < full.radiance.length; index++) {
        assert.ok(
          Math.abs(full.radiance[index] - cached.radiance[index]) <=
            full.errorBound + cached.errorBound + 1e-12,
        );
      }
      if (!warmStart) assert.deepEqual(cached.radiance, full.radiance);
      if (previousMatrix && moved) {
        assert.notDeepEqual(
          cachedMatrix,
          previousMatrix,
          'moving a source changes its geometric transport',
        );
        assert.ok(
          cached.raysTraced > 0 && cached.raysReused > 0,
          'only moved source patches must recast static intersections',
        );
      } else if (previousMatrix) {
        assert.deepEqual(cachedMatrix, previousMatrix);
        assert.equal(cached.raysTraced, 0);
        assert.equal(cached.movingRayTests, 0);
        assert.notDeepEqual(
          cached.radiance,
          previousRadiance,
          'changing colors and intensities must update the light',
        );
      }
      previousMatrix = cachedMatrix;
      previousRadiance = cached.radiance.slice();
    }
    const off = reused.update(illuminatedScene(darkness, 2.5), 'reuse');
    assert.equal(off.converged, true);
    assert.ok(off.residual <= options.tolerance * (1 - off.contraction));
    assert.ok(
      off.radiance.every((value) => Math.abs(value) <= off.errorBound + 1e-12),
      'extinction must remove all previous light within its certified bound',
    );
    assert.equal(off.raysTraced, 0);
    assert.equal(off.movingRayTests, 0);
    if (!warmStart) assert.ok(off.radiance.every((value) => value === 0));
  }
});
