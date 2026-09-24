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

/** An `EngineError`, of this copy of the engine or of another one bundled beside it: by its
 *  `name` and its `code`, as `instanceof` sees only its own class. */
function isEngineError(cause: unknown): cause is Pick<EngineError, 'code' | 'message'> & {
  details?: Record<string, unknown>;
} {
  if (cause instanceof EngineError) return true;
  const { name, code } = (cause ?? {}) as { name?: unknown; code?: unknown };
  return name === 'EngineError' && typeof code === 'string';
}

/** The documented code `cause` carries in `code`, if any. */
function documentedCode(cause: unknown) {
  const code = (cause as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && documented.has(code) ? code : undefined;
}

/** What `cause` says: an error's message; for another object, its `code` when it is a documented
 *  one, else its `message`, else its `code`, else its JSON — never `[object Object]`; anything
 *  else as text. */
function wordsOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause !== 'object' || cause === null) return String(cause);
  const known = documentedCode(cause);
  if (known) return known;
  const { message, code } = cause as { message?: unknown; code?: unknown };
  if (typeof message === 'string') return message;
  if (typeof code === 'string') return code;
  try {
    return JSON.stringify(cause) ?? typeof cause;
  } catch {
    // A cycle, or a value JSON refuses: the kind of object is what can still be said.
    return `${cause.constructor?.name ?? 'Object'} (cannot be written out)`;
  }
}

/**
 * `cause` as a named engine error. An `EngineError` of a documented code as it is — one of
 * another copy of the engine as this copy's, its message and details kept. Anything else under
 * the documented code it carries: its `code` first, then its whole message or text (the bare
 * `new Error('WEBGPU_LOST')` of the renderers) — an engine error's message excepted, which is
 * prose. Else, an `EngineError` of a code no page can test included, under `fallback`. A
 * converted error keeps the one thrown in `details.cause`, stack included.
 */
export function engineErrorOf(cause: unknown, fallback: string, message: string): EngineError {
  const engine = isEngineError(cause);
  if (engine && documented.has(cause.code))
    return cause instanceof EngineError
      ? cause
      : new EngineError(cause.code, cause.message, { ...cause.details, cause });
  const words = wordsOf(cause);
  const code = documentedCode(cause) ?? (!engine && documented.has(words) ? words : fallback);
  return new EngineError(code, `${message}: ${words}`, { cause });
}
