import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState, TRANSPORT_DEFAULTS } from './state.ts';
import { sceneWithBlocker } from '../../../../../tests/fixtures/lightingTransportScene.ts';

const scene = () => sceneWithBlocker(false, 1);

test('a budget that is not a positive whole multiple of four rays, iterations or bytes is refused', () => {
  const invalid = {
    raysPerPatch: [0, -4, 2, 5, 4.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1],
    maxIterations: [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1],
    tolerance: [0, -1, NaN, Infinity],
    maxBytes: [0, -1, NaN, Infinity],
  };
  for (const [field, values] of Object.entries(invalid))
    for (const value of values)
      assert.throws(
        () => createTransportState(scene(), { [field]: value }),
        (error: any) => error.code === 'INVALID_OPTIONS' && /Invalid ray/.test(error.message),
        `${field} ${value}`,
      );
  const smallest = createTransportState(scene(), {
    raysPerPatch: 4,
    maxIterations: 1,
    tolerance: 1e-300,
  });
  assert.deepEqual([smallest.raysPerPatch, smallest.maxIterations], [4, 1]);
});

test('an invalid scene is refused before any budget is checked', () => {
  const broken = scene();
  broken.patches[0].area = -1;
  assert.throws(
    () => createTransportState(broken, { raysPerPatch: 0 }),
    (error: any) => error.code === 'INVALID_SCENE',
  );
});

test('options left out take the default budgets', () => {
  const state = createTransportState(scene(), {});
  const { raysPerPatch, maxIterations, tolerance } = TRANSPORT_DEFAULTS;
  assert.deepEqual(
    [state.raysPerPatch, state.maxIterations, state.tolerance],
    [raysPerPatch, maxIterations, tolerance],
  );
  assert.equal(state.bytes, createTransportState(scene(), TRANSPORT_DEFAULTS).bytes);
});

test('the state sizes its arrays from the scene, unset so the first update sees every change', () => {
  const source = scene();
  const state = createTransportState(source, { raysPerPatch: 8 });
  const size = source.patches.length;
  assert.deepEqual(
    [state.size, state.surfaceCount, state.totalRays],
    [size, source.surfaces.length, size * 8],
  );
  assert.equal(state.matrix.length, size * size);
  assert.equal(state.rays.length / state.totalRays, 6);
  assert.ok(state.packed.every(Number.isNaN) && state.patchGeometry.every(Number.isNaN));
  assert.deepEqual(
    [...state.patchSurface],
    source.patches.map((patch) => patch.surface),
  );
  assert.deepEqual(
    [...state.moving],
    source.surfaces.map((surface) => Number(surface.moving)),
  );
  assert.deepEqual(
    [...state.columns],
    source.surfaces.map((surface) => surface.columns),
  );
  assert.deepEqual(
    [...state.rows],
    source.surfaces.map((surface) => surface.rows),
  );
  assert.deepEqual(
    state.surfaceIds,
    source.surfaces.map((surface) => surface.id),
  );
  assert.deepEqual([state.initialized, state.sphereGeometry], [false, null]);
});

test('the payload counts exactly the arrays the state owns, and a budget one byte short is refused', () => {
  const state = createTransportState(scene(), {});
  const arrays = Object.values(state).filter((value) => ArrayBuffer.isView(value));
  assert.equal(
    state.bytes,
    arrays.reduce((sum, value) => sum + value.byteLength, 0),
  );
  for (const raysPerPatch of [4, 64, 1024]) {
    const { bytes } = createTransportState(scene(), { raysPerPatch });
    assert.doesNotThrow(() => createTransportState(scene(), { raysPerPatch, maxBytes: bytes }));
    assert.throws(
      () => createTransportState(scene(), { raysPerPatch, maxBytes: bytes - 1 }),
      (error: any) =>
        error.code === 'MEMORY_BUDGET_EXCEEDED' && /payload exceeds/.test(error.message),
    );
  }
});

test('a payload past safe arithmetic is refused before any array is allocated', () => {
  const original = globalThis.Float64Array;
  globalThis.Float64Array = new Proxy(original, {
    construct() {
      throw new Error('allocation must not be reached');
    },
  });
  try {
    for (const raysPerPatch of [2 ** 48, 2 ** 52])
      assert.throws(
        () => createTransportState(scene(), { raysPerPatch, maxBytes: Number.MAX_VALUE }),
        (error: any) =>
          error.code === 'MEMORY_BUDGET_EXCEEDED' && /payload exceeds/.test(error.message),
      );
  } finally {
    globalThis.Float64Array = original;
  }
});

test('the clock is the caller’s when given, else the performance clock', () => {
  assert.equal(createTransportState(scene(), { now: () => 42 }).now(), 42);
  const state = createTransportState(scene(), {});
  const before = performance.now(),
    read = state.now();
  assert.ok(read >= before && read <= performance.now());
});
