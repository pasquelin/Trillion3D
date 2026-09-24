import { EngineError } from './cache.ts';

/**
 * Every code an `EngineError` may carry, by family, with what it means: the words a page may test.
 * The one list: `engineErrorOf` reads it, and the API reference prints it under `EngineError`
 * (`scripts/api-reference/docs.ts`).
 */
type CodeFamily = readonly [codes: readonly string[], meaning: string];

export const ENGINE_ERROR_CODES: readonly CodeFamily[] = [
  [
    [
      'CANVAS_NOT_FOUND',
      'CANVAS_DOCUMENT_UNAVAILABLE',
      'CANVAS_WINDOW_UNAVAILABLE',
      'INVALID_CANVAS',
    ],
    'The world has no canvas to draw into: none found, or no page around it.',
  ],
  [
    ['INVALID_CANVAS_LAYOUT', 'INVALID_VIEWPORT', 'INVALID_PIXEL_RATIO'],
    'The canvas has no usable size or pixel ratio.',
  ],
  [
    ['WEBGPU_UNAVAILABLE', 'WEBGL2_UNAVAILABLE', 'NO_WEBGL2', 'NO_ENGINE_BACKEND'],
    'The machine cannot draw the way asked, or cannot draw at all.',
  ],
  [
    ['RESOURCE_HTTP_ERROR', 'INVALID_JSON_RESPONSE'],
    'A file could not be fetched, or was not what it should be.',
  ],
  [
    ['INVALID_POINTER', 'CACHE_NOT_READY', 'SCOPE_MISMATCH'],
    "The compiled model's pointer is broken, unfinished, or of another scope.",
  ],
  [
    ['INVALID_CACHE', 'UNSUPPORTED_FORMAT', 'STALE_CACHE', 'UNSUPPORTED_MODEL_FORMAT'],
    'The compiled model is damaged, too old, too new or of a format not read yet: compile it again.',
  ],
  [
    ['INVALID_SCENE_TABLES', 'UNSUPPORTED_SCENE_TABLES', 'PREPARED_SCENE_MISMATCH'],
    "The model's node and material tables are missing, of another version, or disagree with its scene.",
  ],
  [
    [
      'AUTONOMOUS_SCENE_UNAVAILABLE',
      'AUTONOMOUS_ASSOCIATION_MISSING',
      'AUTONOMOUS_COVERAGE_MISSING',
      'CLUSTER_MATERIAL_UNSUPPORTED',
    ],
    "The engine's own WebGL2 path cannot draw this model.",
  ],
  [
    ['PAGE_BUDGET', 'UNSUPPORTED_MEMORY_BUDGETS'],
    'The pages the view needs do not fit the memory budget, or this path has no budgets.',
  ],
  [
    [
      'INVALID_SCENE_LIGHT',
      'DUPLICATE_SCENE_LIGHT',
      'UNKNOWN_SCENE_LIGHT',
      'SCENE_LIGHT_BUDGET',
      'SCENE_LIGHTS_UNAVAILABLE',
    ],
    'A light is malformed, doubled, unknown, one too many, or has nowhere to go.',
  ],
  [['INVALID_SCENE_ENVIRONMENT'], "The scene's exposure or surroundings are not valid numbers."],
  [
    ['INVALID_TRANSFORM', 'NON_FINITE_TRANSFORM', 'SINGULAR_PARENT_TRANSFORM', 'TRANSFORM_CYCLE'],
    "A node's placement is not a usable matrix, or a node would be its own ancestor.",
  ],
  [
    [
      'UNKNOWN_SCENE_NODE',
      'UNKNOWN_TRANSFORM_NODE',
      'STALE_SCENE_NODE',
      'INVALID_SCENE_NODE_ID',
      'DUPLICATE_SCENE_NODE_ID',
      'INVALID_SCENE_NODE_VISIBILITY',
    ],
    'A scene node is unknown, gone, badly named, or given a visibility that is not yes or no.',
  ],
  [
    ['SCENE_ROOT_PARENT', 'SCENE_ROOT_DESTROY', 'SCENE_ROOT_MISMATCH', 'SCENE_COPY_OVERLAP'],
    'Something the scene root forbids: a parent for it, destroying it, mixing two roots, copying a node into itself.',
  ],
  [
    ['UNSUPPORTED_SCENE_UPDATE', 'BATCHED_WORLD_VIEW'],
    'This drawing path cannot make that change to the scene.',
  ],
  [
    ['RAYCAST_NO_VIEW'],
    'A picture point was asked of a canvas with no size: there is no picture to aim through.',
  ],
  [
    ['WEBGPU_LOST'],
    'WebGPU lost its device, or an error on it left a state nothing can draw from: thrown by `render`, `flush` and the reads that need the device, named by the `gpu-device-lost` diagnostic, and on `world.diagnostic.error` when a session could not open for it.',
  ],
  [
    ['SESSION_OPEN_FAILED'],
    "The world's session could not open, for a reason with no code of its own (`world.diagnostic.error`): the error thrown is in `details.cause`.",
  ],
  [
    ['UNSUPPORTED_SCENE_FORMAT', 'SCENE_NOT_SAVABLE'],
    'A saved scene is of another format or version, or holds what a saved scene cannot store.',
  ],
];

const documented: ReadonlySet<string> = new Set(ENGINE_ERROR_CODES.flatMap(([codes]) => codes));

/**
 * `cause` as a named engine error: an `EngineError` of a documented code as it is; an error whose
 * whole message is a documented code — the bare `new Error('WEBGPU_LOST')` of the renderers — under
 * that code; anything else, an `EngineError` of a code no page can test included, under
 * `fallback`. The error thrown stays in `details.cause`, stack included.
 */
export function engineErrorOf(cause: unknown, fallback: string, message: string): EngineError {
  if (cause instanceof EngineError && documented.has(cause.code)) return cause;
  const words = cause instanceof Error ? cause.message : String(cause);
  const code = !(cause instanceof EngineError) && documented.has(words) ? words : fallback;
  return new EngineError(code, `${message}: ${words}`, { cause });
}
