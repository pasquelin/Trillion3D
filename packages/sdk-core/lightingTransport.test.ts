import test from 'node:test';
import assert from 'node:assert/strict';
import type {Patch, Scene, Surface, Vec3} from './lightingExperimentScene.ts';
import {createTransport, LightingTransportError, LIGHTING_TRANSPORT_ALGORITHM_VERSION, solveTransportOracle} from './lightingTransport.ts';

function sceneWithBlocker(open: boolean, intensity: number): Scene {
  return sceneFromSurfaces([
    {id: 'receiver', origin: [0, -2, -2], u: [0, 4, 0], v: [0, 0, 4], albedo: [.6, .25, .2], emission: [0, 0, 0], kind: 'diffuse', moving: false, columns: 2, rows: 2},
    {id: 'emitter', origin: [2, -2, 2], u: [0, 4, 0], v: [0, 0, -4], albedo: [.2, .2, .2], emission: [4 * intensity, intensity, .5 * intensity], kind: 'diffuse', moving: false, columns: 2, rows: 2},
    {id: 'blocker', origin: [1, open ? 8 : -3, 3], u: [0, 6, 0], v: [0, 0, -6], albedo: [0, 0, 0], emission: [0, 0, 0], kind: 'diffuse', moving: true, columns: 1, rows: 1},
  ]);
}

function sceneFromSurfaces(surfaces: Surface[]): Scene {
  const patches: Patch[] = [];
  surfaces.forEach((surface, surfaceIndex) => {
    const u = surface.u.map(value => value / surface.columns) as Vec3;
    const v = surface.v.map(value => value / surface.rows) as Vec3;
    const cross: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const area = Math.hypot(...cross), normal = cross.map(value => value / area) as Vec3;
    for (let row = 0; row < surface.rows; row++) for (let column = 0; column < surface.columns; column++) {
      const center = surface.origin.map((value, axis) => value + (column + .5) * u[axis] + (row + .5) * v[axis]) as Vec3;
      patches.push({id: patches.length, surface: surfaceIndex, center, u, v, normal, area, albedo: [...surface.albedo], emission: [...surface.emission]});
    }
  });
  return {surfaces, patches};
}

test('cached static intersections preserve the complete operator through blocker moves and relighting', () => {
  const firstScene = sceneWithBlocker(false, 1);
  const options = {raysPerPatch: 64, maxIterations: 128, tolerance: 1e-10};
  const rebuilt = createTransport(firstScene, options), reused = createTransport(firstScene, options);
  let previousSnapshot: ReturnType<typeof reused.snapshot> | undefined;
  let previousMatrix: Float64Array | undefined;
  for (const [open, intensity, geometryChanges] of [[false, 1, true], [true, 1, true], [true, 2, false], [false, 2, true], [true, .37, true]] as const) {
    const scene = sceneWithBlocker(open, intensity);
    const full = rebuilt.update(scene, 'rebuild'), cached = reused.update(scene, 'reuse');
    const fullSnapshot = rebuilt.snapshot(), cachedSnapshot = reused.snapshot();
    assert.deepEqual(cachedSnapshot.matrix, fullSnapshot.matrix, 'reuse must retain the exact same sampled transport');
    assert.equal(full.converged, true); assert.equal(cached.converged, true);
    const oracle = solveTransportOracle(fullSnapshot);
    assert.ok(oracle.residual < 1e-12);
    for (let i = 0; i < oracle.radiance.length; i++) {
      assert.ok(Math.abs(full.radiance[i] - oracle.radiance[i]) <= full.errorBound + 1e-12);
      assert.ok(Math.abs(cached.radiance[i] - oracle.radiance[i]) <= cached.errorBound + 1e-12);
      assert.ok(Math.abs(full.radiance[i] - cached.radiance[i]) <= full.errorBound + cached.errorBound + 1e-12);
      assert.ok(cached.irradiance[i] >= 0 && Number.isFinite(cached.irradiance[i]));
    }
    for (let row = 0; row < cachedSnapshot.patchCount; row++) {
      let sum = 0;
      for (let column = 0; column < cachedSnapshot.patchCount; column++) {
        const coefficient = cachedSnapshot.matrix[row * cachedSnapshot.patchCount + column];
        assert.ok(coefficient >= 0); sum += coefficient;
      }
      assert.ok(sum <= 1, 'escaped and absorbed rays must never create energy');
      for (let channel = 0; channel < 3; channel++) {
        const at = row * 3 + channel;
        const reconstructed = cachedSnapshot.source[at] + cachedSnapshot.albedo[at] * cached.irradiance[at] / Math.PI;
        assert.ok(Math.abs(reconstructed - cached.radiance[at]) <= cached.residual + 1e-12, 'irradiance has the required pi factor');
      }
    }
    const receiverLight = cached.radiance[0] + cached.radiance[3] + cached.radiance[6] + cached.radiance[9];
    if (open) assert.ok(receiverLight > .01, 'opening must rediscover the emitter');
    else assert.ok(receiverLight < options.tolerance * 4, 'closing must extinguish the receiver');
    assert.equal(full.raysTraced, full.totalRays);
    if (previousSnapshot) {
      assert.ok(cached.raysReused > 0);
      assert.deepEqual(previousSnapshot.matrix, previousMatrix, 'oracle snapshots own their arrays');
    }
    if (!geometryChanges) {
      assert.equal(cached.raysTraced, 0);
      assert.equal(cached.movingRayTests, 0);
      assert.equal(cached.rowsUpdated, 0);
    }
    previousSnapshot = cachedSnapshot; previousMatrix = cachedSnapshot.matrix.slice();
  }
});

test('dense oracle matches the closed-form two-surface multiple-bounce solution', () => {
  const source = Float64Array.of(1, 2, 3, 4, 5, 6);
  const albedo = Float64Array.of(.6, .3, .9, .4, .7, .2);
  const result = solveTransportOracle({formatVersion: 1, algorithmVersion: LIGHTING_TRANSPORT_ALGORITHM_VERSION,
    patchCount: 2, matrix: Float64Array.of(0, .5, .25, 0), source, albedo});
  for (let channel = 0; channel < 3; channel++) {
    const a = albedo[channel] * .5, b = albedo[3 + channel] * .25;
    const first = (source[channel] + a * source[3 + channel]) / (1 - a * b);
    const second = source[3 + channel] + b * first;
    assert.ok(Math.abs(result.radiance[channel] - first) < 1e-12);
    assert.ok(Math.abs(result.radiance[3 + channel] - second) < 1e-12);
  }
  assert.ok(result.residual < 1e-12);
});

test('indirect irradiance excludes direct emission but retains reflections from emissive surfaces', () => {
  const scene = sceneWithBlocker(true, 1);
  const state = createTransport(scene, {raysPerPatch: 64, tolerance: 1e-10});
  const result = state.update(scene, 'rebuild');
  const snapshot = state.snapshot();
  for (let row = 0; row < snapshot.patchCount; row++) for (let channel = 0; channel < 3; channel++) {
    let direct = 0;
    for (let column = 0; column < snapshot.patchCount; column++) {
      direct += snapshot.matrix[row * snapshot.patchCount + column] * snapshot.source[column * 3 + channel];
    }
    const at = row * 3 + channel;
    assert.ok(result.indirectIrradiance[at] >= 0);
    assert.ok(Math.abs(result.irradiance[at] - result.indirectIrradiance[at] - Math.PI * direct) < 1e-12,
      'direct emission must appear exactly once when composing direct and indirect irradiance');
  }
  assert.ok(result.indirectIrradiance[0] > 0, 'the emitting surface also reflects light back to the receiver');
  assert.throws(() => createTransport(scene, {raysPerPatch: 64, maxBytes: result.bytes - 1}),
    (error: unknown) => error instanceof LightingTransportError && error.code === 'MEMORY_BUDGET_EXCEEDED');
  const admitted = createTransport(scene, {raysPerPatch: 64, maxBytes: result.bytes}).update(scene, 'rebuild');
  assert.equal(admitted.bytes, result.bytes, 'the allocation estimate includes the new irradiance buffer exactly');
});

test('canonical solver initialization makes full and reused transport byte-identical through scene changes', () => {
  const initial = sceneWithBlocker(false, 1);
  const options = {raysPerPatch: 64, tolerance: 1e-8, warmStart: false};
  const rebuilt = createTransport(initial, options), reused = createTransport(initial, options);
  for (const [open, intensity] of [[false, 1], [true, 1], [true, .37], [false, .37], [true, 0], [true, 2]] as const) {
    const scene = sceneWithBlocker(open, intensity);
    const full = rebuilt.update(scene, 'rebuild'), cached = reused.update(scene, 'reuse');
    assert.equal(full.converged, true); assert.equal(cached.converged, true);
    assert.deepEqual(cached.radiance, full.radiance);
    assert.deepEqual(cached.irradiance, full.irradiance);
    assert.deepEqual(cached.indirectIrradiance, full.indirectIrradiance);
    assert.equal(cached.iterations, full.iterations);
    assert.equal(cached.residual, full.residual);
  }
});

test('three colored emitters combine linearly, relight independently and preserve transport when moved', () => {
  const colors: Vec3[] = [[4, .2, .1], [.1, 2, .2], [.2, .1, 3]];
  const changedColors: Vec3[] = [[.1, .3, 1.2], [2.1, .1, .2], [.4, .7, .1]];
  const darkness: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  function illuminatedScene(emissions: Vec3[], thirdEmitterX = 2): Scene {
    return sceneFromSurfaces([
      {id: 'receiver', origin: [0, -3, -3], u: [0, 6, 0], v: [0, 0, 6], albedo: [.6, .5, .4], emission: [0, 0, 0], kind: 'diffuse', moving: false, columns: 3, rows: 3},
      ...emissions.map((emission, index): Surface => ({
        id: `light-${index}`, origin: [index === 2 ? thirdEmitterX : 2, -2, index * 2 - 1],
        u: [0, 4, 0], v: [0, 0, -2], albedo: [.3, .3, .3], emission,
        kind: 'diffuse', moving: true, columns: 2, rows: 1,
      })),
    ]);
  }
  const options = {raysPerPatch: 64, tolerance: 1e-10};
  const initial = illuminatedScene(colors);
  const combined = createTransport(initial, options).update(initial, 'rebuild');
  assert.equal(combined.converged, true);
  const individual = colors.map((_, emitter) => {
    const scene = illuminatedScene(colors.map((color, index): Vec3 => index === emitter ? color : [0, 0, 0]));
    return createTransport(scene, options).update(scene, 'rebuild');
  });
  const linearityBound = combined.errorBound + individual.reduce((sum, result) => sum + result.errorBound, 0) + 1e-12;
  for (let index = 0; index < combined.radiance.length; index++) {
    const sum = individual.reduce((value, result) => value + result.radiance[index], 0);
    assert.ok(Math.abs(combined.radiance[index] - sum) <= linearityBound, 'multiple sources must sum in linear radiance');
  }
  for (const result of individual) {
    assert.equal(result.converged, true);
    assert.ok(result.radiance.subarray(0, 27).some(value => value > .01), 'each source must illuminate the receiver');
  }
  for (const warmStart of [true, false]) {
    const rebuilt = createTransport(initial, {...options, warmStart});
    const reused = createTransport(initial, {...options, warmStart});
    let previousMatrix: Float64Array | undefined;
    let previousRadiance: Float64Array | undefined;
    for (const [emissions, position, moved] of [[colors, 2, false], [changedColors, 2, false], [changedColors, 1.1, true], [changedColors, 2.5, true]] as const) {
      const scene = illuminatedScene(emissions, position);
      const full = rebuilt.update(scene, 'rebuild'), cached = reused.update(scene, 'reuse');
      const cachedMatrix = reused.snapshot().matrix;
      assert.equal(full.converged, true); assert.equal(cached.converged, true);
      assert.deepEqual(cachedMatrix, rebuilt.snapshot().matrix, 'moving an emitter must preserve the rebuilt operator');
      for (let index = 0; index < full.radiance.length; index++) {
        assert.ok(Math.abs(full.radiance[index] - cached.radiance[index]) <= full.errorBound + cached.errorBound + 1e-12);
      }
      if (!warmStart) assert.deepEqual(cached.radiance, full.radiance);
      if (previousMatrix && moved) {
        assert.notDeepEqual(cachedMatrix, previousMatrix, 'moving a source changes its geometric transport');
        assert.ok(cached.raysTraced > 0 && cached.raysReused > 0, 'only moved source patches must recast static intersections');
      } else if (previousMatrix) {
        assert.deepEqual(cachedMatrix, previousMatrix);
        assert.equal(cached.raysTraced, 0); assert.equal(cached.movingRayTests, 0);
        assert.notDeepEqual(cached.radiance, previousRadiance, 'changing colors and intensities must update the light');
      }
      previousMatrix = cachedMatrix; previousRadiance = cached.radiance.slice();
    }
    const off = reused.update(illuminatedScene(darkness, 2.5), 'reuse');
    assert.equal(off.converged, true);
    assert.ok(off.residual <= options.tolerance * (1 - off.contraction));
    assert.ok(off.radiance.every(value => Math.abs(value) <= off.errorBound + 1e-12), 'extinction must remove all previous light within its certified bound');
    assert.equal(off.raysTraced, 0); assert.equal(off.movingRayTests, 0);
    if (!warmStart) assert.ok(off.radiance.every(value => value === 0));
  }
});

test('cancellation never publishes a partial operator and a retry rebuilds it', () => {
  let cancelled = false, interrupt = true;
  const scene = sceneWithBlocker(true, 1);
  const state = createTransport(scene, {cancelled: () => cancelled, onProgress: event => {
    if (interrupt && event.stage === 'visibility') cancelled = true;
  }});
  assert.throws(() => state.update(scene, 'reuse'), (error: unknown) => error instanceof LightingTransportError && error.code === 'CANCELLED');
  assert.throws(() => state.snapshot(), (error: unknown) => error instanceof LightingTransportError && error.code === 'NOT_READY');
  cancelled = false; interrupt = false;
  const result = state.update(scene, 'reuse');
  assert.equal(result.converged, true);
  assert.equal(result.raysTraced, result.totalRays);
});
