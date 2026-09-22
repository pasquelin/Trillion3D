import { EngineError } from '../../../sdk-core/index.ts';
import { checked } from '../../clusterPages.ts';

/** What a model resource is, read from its content: never from its extension. */
export type ModelFormat = 'manifest' | 'gltf' | 'glb' | 'obj' | 'unknown';

/** The first word of an OBJ statement, of those a file opens its geometry with. */
const OBJ_STATEMENT = /^(?:v|vn|vt|f|o|g|s|l|p|mtllib|usemtl)\s/;

/** The verdict the text read so far allows, or `null` while it allows none. */
function verdict(text: string, complete: boolean): ModelFormat | null {
  const body = text.replace(/^\uFEFF/, '').trimStart();
  if (!body) return complete ? 'unknown' : null;
  if (body.startsWith('{')) {
    // A glTF declares its `asset`; a compiled pointer or manifest its readiness `status`.
    if (/"asset"\s*:/.test(body)) return 'gltf';
    if (/"status"\s*:/.test(body)) return 'manifest';
    return complete ? 'unknown' : null;
  }
  for (const line of body.split('\n')) {
    const statement = line.trim();
    if (!statement || statement.startsWith('#')) continue;
    if (OBJ_STATEMENT.test(`${statement} `)) return 'obj';
    return 'unknown';
  }
  return complete ? 'unknown' : null;
}

/**
 * Reads the head of `url` — the chunks the response delivers, no more than its content needs to
 * be named — and names the model format: a binary glTF by its `glTF` magic, a JSON document by
 * the field its shape declares, an OBJ by its first statement. The rest is never downloaded.
 */
export async function detectModelFormat(url: string, signal?: AbortSignal) {
  const reader = (await checked(url, signal)).body?.getReader();
  if (!reader) return 'unknown';
  const decoder = new TextDecoder();
  let text = '',
    first = true;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value && first && value.length >= 4) {
        if (value[0] === 0x67 && value[1] === 0x6c && value[2] === 0x54 && value[3] === 0x46)
          return 'glb';
        first = false;
      }
      if (value) text += decoder.decode(value, { stream: !done });
      const found = verdict(text, done);
      if (found) return found;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

/** A model loader, by the format it reads. */
export type ModelLoader<T, O> = (url: string, options: O) => Promise<T>;

/**
 * The one door every model goes through: its format is detected (`detectModelFormat`) and the
 * loader registered for it reads it. A format no loader is registered for is refused by name —
 * the source formats wait for the runtime compiler (#252), which will register them.
 */
export async function loadModelOfAnyFormat<T, O extends { signal?: AbortSignal }>(
  url: string,
  options: O,
  loaders: Partial<Record<ModelFormat, ModelLoader<T, O>>>,
) {
  const format = await detectModelFormat(url, options.signal);
  const load = loaders[format];
  if (!load)
    throw new EngineError(
      'UNSUPPORTED_MODEL_FORMAT',
      `${url}: ${format} models cannot be loaded yet; the runtime compiler (#252) will read them`,
      { url, format },
    );
  return load(url, options);
}
