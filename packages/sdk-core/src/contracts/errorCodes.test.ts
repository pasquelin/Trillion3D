import test from 'node:test'
import assert from 'node:assert/strict'
import { engineErrorOf } from './errorCodes.ts'
import { EngineError } from './cache.ts'

test('an error becomes a named engine error, its cause kept', () => {
  const named = new EngineError('PAGE_BUDGET', 'too many pages')
  assert.equal(engineErrorOf(named, 'FALLBACK', 'x'), named)
  const lost = new Error('WEBGPU_UNAVAILABLE')
  const converted = engineErrorOf(lost, 'FALLBACK', 'Opening failed')
  assert.equal(converted.code, 'WEBGPU_UNAVAILABLE')
  assert.equal(converted.message, 'Opening failed: WEBGPU_UNAVAILABLE')
  assert.equal(converted.details.cause, lost)
  // A code not documented, or any other text, is the fallback's.
  assert.equal(engineErrorOf(new Error('PAGE_HTTP_404'), 'FALLBACK', 'x').code, 'FALLBACK')
  assert.equal(engineErrorOf('boom', 'FALLBACK', 'x').code, 'FALLBACK')
})

test('an engine error of a code no page can test is the fallback, the original its cause', () => {
  const undocumented = new EngineError('PAGE_HTTP_404', 'not found')
  const converted = engineErrorOf(undocumented, 'FALLBACK', 'Opening failed')
  assert.equal(converted.code, 'FALLBACK')
  assert.equal(converted.message, 'Opening failed: not found')
  assert.equal(converted.details.cause, undocumented)
  // Its message is not taken for a code either.
  const worded = new EngineError('PAGE_HTTP_404', 'WEBGPU_LOST')
  assert.equal(engineErrorOf(worded, 'FALLBACK', 'x').code, 'FALLBACK')
})

test('an object that is no error says its message, its code or its JSON, never [object Object]', () => {
  const said = (cause: unknown) => engineErrorOf(cause, 'FALLBACK', 'Opening failed').message
  assert.equal(said({ message: 'adapter refused' }), 'Opening failed: adapter refused')
  assert.equal(engineErrorOf({ code: 'WEBGPU_LOST' }, 'FALLBACK', 'x').code, 'WEBGPU_LOST')
  assert.equal(said({ reason: 'gone', at: 3 }), 'Opening failed: {"reason":"gone","at":3}')
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  assert.equal(said(cycle), 'Opening failed: Object (cannot be written out)')
  assert.doesNotMatch(said(Object.create(null)), /\[object Object\]/)
})

test('an object carrying a documented code is under that code first, its message after', () => {
  const lost = { code: 'WEBGPU_LOST', message: 'device gone' }
  const converted = engineErrorOf(lost, 'FALLBACK', 'Opening failed')
  assert.equal(converted.code, 'WEBGPU_LOST')
  assert.equal(converted.message, 'Opening failed: WEBGPU_LOST')
  // A code no page tests is not: the message is what it says.
  assert.equal(engineErrorOf({ code: 'E42', message: 'no' }, 'FALLBACK', 'x').code, 'FALLBACK')
})

test('an engine error of another copy of the engine is taken for one, by its name and code', () => {
  const foreign = Object.assign(new Error('the device is gone'), {
    name: 'EngineError',
    code: 'WEBGPU_LOST',
    details: { at: 'render' },
  })
  const converted = engineErrorOf(foreign, 'FALLBACK', 'x')
  assert.ok(converted instanceof EngineError)
  assert.equal(converted.code, 'WEBGPU_LOST')
  assert.equal(converted.message, 'the device is gone')
  assert.deepEqual(converted.details, { at: 'render', cause: foreign })
  // Of a code no page tests, it is the fallback; its message is prose, never taken for a code.
  const worded = Object.assign(new Error('WEBGPU_LOST'), { name: 'EngineError', code: 'E42' })
  assert.equal(engineErrorOf(worded, 'FALLBACK', 'x').code, 'FALLBACK')
})

// The codes the API reference publishes, the words a page tests, written here as a page reads them
// and not taken from `ENGINE_ERROR_CODES`: a code renamed or dropped breaks the pages testing it, so
// it breaks this list too, where reading the catalogue would follow it silently.
const published = `
  CANVAS_NOT_FOUND CANVAS_DOCUMENT_UNAVAILABLE CANVAS_WINDOW_UNAVAILABLE INVALID_CANVAS
  INVALID_CANVAS_LAYOUT INVALID_VIEWPORT INVALID_PIXEL_RATIO WEBGPU_UNAVAILABLE
  WEBGL2_UNAVAILABLE NO_WEBGL2 NO_ENGINE_BACKEND RESOURCE_HTTP_ERROR INVALID_JSON_RESPONSE
  INVALID_POINTER CACHE_NOT_READY SCOPE_MISMATCH INVALID_CACHE UNSUPPORTED_FORMAT STALE_CACHE
  UNSUPPORTED_MODEL_FORMAT INVALID_SCENE_TABLES UNSUPPORTED_SCENE_TABLES PREPARED_SCENE_MISMATCH
  AUTONOMOUS_SCENE_UNAVAILABLE AUTONOMOUS_ASSOCIATION_MISSING AUTONOMOUS_COVERAGE_MISSING
  CLUSTER_MATERIAL_UNSUPPORTED PAGE_BUDGET UNSUPPORTED_MEMORY_BUDGETS INVALID_SCENE_LIGHT
  DUPLICATE_SCENE_LIGHT UNKNOWN_SCENE_LIGHT SCENE_LIGHTS_UNAVAILABLE INVALID_SCENE_ENVIRONMENT
  INVALID_MATERIAL UNKNOWN_MATERIAL MATERIAL_CLASS_CHANGE MATERIAL_TEXTURE_SHARED
  MATERIAL_CEILING TEXTURE_BUDGET INVALID_TRANSFORM NON_FINITE_TRANSFORM
  SINGULAR_PARENT_TRANSFORM TRANSFORM_CYCLE UNKNOWN_SCENE_NODE UNKNOWN_TRANSFORM_NODE
  STALE_SCENE_NODE INVALID_SCENE_NODE_ID DUPLICATE_SCENE_NODE_ID INVALID_SCENE_NODE_VISIBILITY
  SCENE_ROOT_PARENT SCENE_ROOT_DESTROY SCENE_ROOT_MISMATCH SCENE_COPY_OVERLAP
  UNSUPPORTED_SCENE_UPDATE BATCHED_WORLD_VIEW RAYCAST_NO_VIEW SURFACE_CAPTURE_UNSUPPORTED
  VERTICES_NOT_LOADED WEBGPU_LOST SESSION_OPEN_FAILED FAMILY_LOAD_FAILED UNSUPPORTED_SCENE_FORMAT
  SCENE_NOT_SAVABLE PHYSICS_BUDGET PHYSICS_NESTED PHYSICS_FAILED PHYSICS_DIVERGED PHYSICS_FORMAT
  PHYSICS_OFF NO_VEHICLE GUIDE_CEILING REFERENCE_SHADOWS_REDUCED REFERENCE_INTERACTIVE
`
  .trim()
  .split(/\s+/)

test('host refusals survive a local relay and a JSON transport between engine copies', () => {
  for (const code of published) {
    const original = new EngineError(code, 'The requested operation failed', {
      node: 7,
      limit: 10,
    })
    assert.equal(engineErrorOf(original, 'SESSION_OPEN_FAILED', 'Opening'), original)
    const transported = JSON.parse(
      JSON.stringify({
        name: original.name,
        code: original.code,
        message: original.message,
        details: original.details,
      }),
    )
    const received = engineErrorOf(transported, 'SESSION_OPEN_FAILED', 'Opening')
    assert.ok(received instanceof EngineError)
    assert.equal(received.name, 'EngineError')
    assert.equal(received.code, code)
    assert.equal(received.message, original.message)
    assert.deepEqual(received.details, { node: 7, limit: 10, cause: transported })
    const bare = new Error(code)
    assert.equal(engineErrorOf(bare, 'SESSION_OPEN_FAILED', 'Opening').code, code)
  }
})

test('opaque host failures retain a readable message and the exact original cause', () => {
  const misleading = { name: 'EngineError', code: 42, message: 'WEBGPU_LOST' }
  assert.equal(engineErrorOf(misleading, 'SESSION_OPEN_FAILED', 'Opening').code, 'WEBGPU_LOST')
  for (const cause of ['unrecognized', 17, null])
    assert.equal(
      engineErrorOf(cause, 'SESSION_OPEN_FAILED', 'Opening').message,
      `Opening: ${String(cause)}`,
    )
  const ordinary = { code: 'WEBGPU_LOST', message: 'adapter failure', details: { retry: 1 } }
  const ordinaryResult = engineErrorOf(ordinary, 'SESSION_OPEN_FAILED', 'Opening')
  assert.equal(ordinaryResult.message, 'Opening: WEBGPU_LOST')
  assert.deepEqual(ordinaryResult.details, { cause: ordinary })
  const unknown = { name: 'EngineError', code: 'PRIVATE_VENDOR', message: 'opaque' }
  assert.equal(engineErrorOf(unknown, 'SESSION_OPEN_FAILED', 'Opening').message, 'Opening: opaque')
  assert.equal(
    engineErrorOf({ code: 'PRIVATE_VENDOR' }, 'SESSION_OPEN_FAILED', 'Opening').message,
    'Opening: PRIVATE_VENDOR',
  )
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
        return undefined
      },
    },
  ]) {
    const result = engineErrorOf(cause, 'SESSION_OPEN_FAILED', 'Opening')
    assert.equal(result.code, 'SESSION_OPEN_FAILED')
    assert.equal(result.details.cause, cause)
    assert.ok(result.message.startsWith('Opening: '))
    assert.ok(result.message.length > 'Opening: '.length)
    assert.equal(result.message.includes('[object Object]'), false)
  }
  const cycle = Object.create(null) as Record<string, unknown>
  cycle.self = cycle
  assert.equal(
    engineErrorOf(cycle, 'SESSION_OPEN_FAILED', 'Opening').message,
    'Opening: Object (cannot be written out)',
  )
})
