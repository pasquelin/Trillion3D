import { EngineError } from './cache.ts';

/** Every code documented on `EngineError` (`@errorCode`), in their order: the words a page may
 *  test. `errorCodes.test.ts` keeps it equal to the tags. */
export const ENGINE_ERROR_CODES: ReadonlySet<string> = new Set([
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
  'SCENE_LIGHT_BUDGET',
  'SCENE_LIGHTS_UNAVAILABLE',
  'INVALID_SCENE_ENVIRONMENT',
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
  'WEBGPU_LOST',
  'SESSION_OPEN_FAILED',
  'UNSUPPORTED_SCENE_FORMAT',
  'SCENE_NOT_SAVABLE',
]);

/**
 * `cause` as a named engine error: an `EngineError` as it is; an error whose whole message is a
 * documented code — the bare `new Error('WEBGPU_LOST')` of the renderers — under that code; anything
 * else under `fallback`. The error thrown stays in `details.cause`, stack included.
 */
export function engineErrorOf(cause: unknown, fallback: string, message: string): EngineError {
  if (cause instanceof EngineError) return cause;
  const words = cause instanceof Error ? cause.message : String(cause);
  const code = ENGINE_ERROR_CODES.has(words) ? words : fallback;
  return new EngineError(code, `${message}: ${words}`, { cause });
}
