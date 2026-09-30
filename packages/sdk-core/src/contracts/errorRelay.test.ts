import assert from 'node:assert/strict';
import test from 'node:test';
import { EngineError } from './cache.ts';
import { engineErrorOf } from './errorCodes.ts';

// Independent host-side failure scenarios: a serialized refusal must retain its public code,
// prose and facts across engine copies. This does not read the implementation's code catalogue.
const hostFailures = [
  'CANVAS_NOT_FOUND',
  'CANVAS_DOCUMENT_UNAVAILABLE',
  'CANVAS_WINDOW_UNAVAILABLE',
  'INVALID_CANVAS',
  'INVALID_CANVAS_LAYOUT',
  'INVALID_VIEWPORT',
  'INVALID_PIXEL_RATIO',
  'WEBGPU_UNAVAILABLE',
  'WEBGL2_UNAVAILABLE',
  'NO_WEBGL2',
  'NO_ENGINE_BACKEND',
  'RESOURCE_HTTP_ERROR',
  'INVALID_JSON_RESPONSE',
  'INVALID_POINTER',
  'CACHE_NOT_READY',
  'SCOPE_MISMATCH',
  'INVALID_CACHE',
  'UNSUPPORTED_FORMAT',
  'STALE_CACHE',
  'UNSUPPORTED_MODEL_FORMAT',
  'INVALID_SCENE_TABLES',
  'UNSUPPORTED_SCENE_TABLES',
  'PREPARED_SCENE_MISMATCH',
  'AUTONOMOUS_SCENE_UNAVAILABLE',
  'AUTONOMOUS_ASSOCIATION_MISSING',
  'AUTONOMOUS_COVERAGE_MISSING',
  'CLUSTER_MATERIAL_UNSUPPORTED',
  'PAGE_BUDGET',
  'UNSUPPORTED_MEMORY_BUDGETS',
  'INVALID_SCENE_LIGHT',
  'DUPLICATE_SCENE_LIGHT',
  'UNKNOWN_SCENE_LIGHT',
  'SCENE_LIGHTS_UNAVAILABLE',
  'INVALID_SCENE_ENVIRONMENT',
  'INVALID_MATERIAL',
  'UNKNOWN_MATERIAL',
  'MATERIAL_CLASS_CHANGE',
  'MATERIAL_TEXTURE_SHARED',
  'MATERIAL_CEILING',
  'TEXTURE_BUDGET',
  'INVALID_TRANSFORM',
  'NON_FINITE_TRANSFORM',
  'SINGULAR_PARENT_TRANSFORM',
  'TRANSFORM_CYCLE',
  'UNKNOWN_SCENE_NODE',
  'UNKNOWN_TRANSFORM_NODE',
  'STALE_SCENE_NODE',
  'INVALID_SCENE_NODE_ID',
  'DUPLICATE_SCENE_NODE_ID',
  'INVALID_SCENE_NODE_VISIBILITY',
  'SCENE_ROOT_PARENT',
  'SCENE_ROOT_DESTROY',
  'SCENE_ROOT_MISMATCH',
  'SCENE_COPY_OVERLAP',
  'UNSUPPORTED_SCENE_UPDATE',
  'BATCHED_WORLD_VIEW',
  'RAYCAST_NO_VIEW',
  'SURFACE_CAPTURE_UNSUPPORTED',
  'VERTICES_NOT_LOADED',
  'WEBGPU_LOST',
  'SESSION_OPEN_FAILED',
  'UNSUPPORTED_SCENE_FORMAT',
  'SCENE_NOT_SAVABLE',
  'PHYSICS_BUDGET',
  'PHYSICS_NESTED',
  'PHYSICS_FAILED',
  'PHYSICS_DIVERGED',
  'PHYSICS_FORMAT',
  'PHYSICS_OFF',
  'NO_VEHICLE',
  'GUIDE_CEILING',
  'REFERENCE_SHADOWS_REDUCED',
  'REFERENCE_INTERACTIVE',
];

test('host refusals survive a local relay and a JSON transport between engine copies', () => {
  for (const code of hostFailures) {
    const original = new EngineError(code, 'The requested operation failed', {
      node: 7,
      limit: 10,
    });
    assert.equal(engineErrorOf(original, 'SESSION_OPEN_FAILED', 'Opening'), original);
    const transported = JSON.parse(
      JSON.stringify({
        name: original.name,
        code: original.code,
        message: original.message,
        details: original.details,
      }),
    );
    const received = engineErrorOf(transported, 'SESSION_OPEN_FAILED', 'Opening');
    assert.ok(received instanceof EngineError);
    assert.equal(received.name, 'EngineError');
    assert.equal(received.code, code);
    assert.equal(received.message, original.message);
    assert.deepEqual(received.details, { node: 7, limit: 10, cause: transported });
    const bare = new Error(code);
    assert.equal(engineErrorOf(bare, 'SESSION_OPEN_FAILED', 'Opening').code, code);
  }
});

test('opaque host failures retain a readable message and the exact original cause', () => {
  const misleading = { name: 'EngineError', code: 42, message: 'WEBGPU_LOST' };
  assert.equal(engineErrorOf(misleading, 'SESSION_OPEN_FAILED', 'Opening').code, 'WEBGPU_LOST');
  for (const cause of ['unrecognized', 17, null])
    assert.equal(
      engineErrorOf(cause, 'SESSION_OPEN_FAILED', 'Opening').message,
      `Opening: ${String(cause)}`,
    );
  const ordinary = { code: 'WEBGPU_LOST', message: 'adapter failure', details: { retry: 1 } };
  const ordinaryResult = engineErrorOf(ordinary, 'SESSION_OPEN_FAILED', 'Opening');
  assert.equal(ordinaryResult.message, 'Opening: WEBGPU_LOST');
  assert.deepEqual(ordinaryResult.details, { cause: ordinary });
  const unknown = { name: 'EngineError', code: 'PRIVATE_VENDOR', message: 'opaque' };
  assert.equal(engineErrorOf(unknown, 'SESSION_OPEN_FAILED', 'Opening').message, 'Opening: opaque');
  assert.equal(
    engineErrorOf({ code: 'PRIVATE_VENDOR' }, 'SESSION_OPEN_FAILED', 'Opening').message,
    'Opening: PRIVATE_VENDOR',
  );
  for (const cause of [
    undefined,
    null,
    0,
    false,
    Symbol('host failure'),
    { code: 42 },
    { message: 7 },
    {
      toJSON() {
        return undefined;
      },
    },
  ]) {
    const result = engineErrorOf(cause, 'SESSION_OPEN_FAILED', 'Opening');
    assert.equal(result.code, 'SESSION_OPEN_FAILED');
    assert.equal(result.details.cause, cause);
    assert.ok(result.message.startsWith('Opening: '));
    assert.ok(result.message.length > 'Opening: '.length);
    assert.equal(result.message.includes('[object Object]'), false);
  }
  const cycle = Object.create(null) as Record<string, unknown>;
  cycle.self = cycle;
  assert.equal(
    engineErrorOf(cycle, 'SESSION_OPEN_FAILED', 'Opening').message,
    'Opening: Object (cannot be written out)',
  );
  const fake = { name: 'EngineError', code: 42, message: 'opaque' };
  assert.equal(engineErrorOf(fake, 'SESSION_OPEN_FAILED', 'Opening').code, 'SESSION_OPEN_FAILED');
});
