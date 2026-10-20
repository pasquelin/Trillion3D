import type { LoadOptions } from './scene.ts'
import { loadModel, placeModel, type LoadedModel } from './models/loadedModel.ts'
import { loadModelOfAnyFormat } from './models/modelFormat.ts'
import type { PageCache } from '../../geometry/streaming/pageCache.ts'
import { createDeferred } from '../../../../sdk-core/src/runtime/deferred.ts'

/**
 * The one door for every model a world's scene loads: its format is read from its content, then
 * its loader — today the compiled manifest's alone — reads it (`models/modelFormat.ts`), once the world
 * holds its device. A world that draws nothing yet opens its first session once the models asked
 * for meanwhile are in its scene (`loading`): one session opens on all of them. Each model leaves
 * its baked images to its cache, whose levels the session reads. A world already holding a session
 * (`held`) waits for nothing: a model it loads joins that session in place (`models/modelJoin.ts`).
 * A manifest the world read already — the same address at the same scope — is never read again:
 * its load resolves to another placement of the model read first (`placeModel`), its own world
 * over the same manifest, graph, images, pages and buffers, which the world draws as one more row
 * of the same sources.
 */
export function worldModelLoader(
  ready: Promise<unknown>,
  signal: AbortSignal | undefined,
  /** The world's page cache, which its models and sessions read through. */
  pageCache: PageCache,
  /** Whether a session is open or opening: it can no more be based on a model not yet loaded. */
  held: () => boolean = () => false,
  /** Hears each model the scene adds, once it holds it: the world reads its scene settings. */
  heard: (model: LoadedModel) => void = () => {},
) {
  /** The load of each manifest the world read, by its address: a manifest asked again is placed
   *  again (`placeModel`), never read again. */
  const read = new Map<string, Promise<LoadedModel>>()
  /** The loads a session not yet opened waits for, each settled once its model is in the scene. */
  const waited = new Set<Promise<void>>()
  /** What settles each of those once the scene says it holds the model (`added`). */
  const holding = new Map<LoadedModel, () => void>()
  /** The model `url` names at `scope`: read once per world, placed again for every later ask. */
  const modelAt = (url: string, options: LoadOptions) => {
    const scope =
      options.scope === undefined ? undefined : options.scope === 'full' ? 'full' : 'slice'
    const key = `${scope ?? ''} ${new URL(url, globalThis.document?.baseURI ?? 'http://localhost/').href}`
    const first = read.get(key)
    if (first) return first.then(placeModel)
    const reading = {
      scope,
      signal: options.signal ?? signal,
      onProgress: options.onProgress,
      pageCache,
    } as const
    const loading = ready.then(() => loadModelOfAnyFormat(url, reading, { manifest: loadModel }))
    read.set(key, loading)
    // A read that failed is asked again by the next load.
    loading.catch(() => read.get(key) === loading && read.delete(key))
    return loading
  }
  const load = async (url: string, options: LoadOptions) => {
    const waits = !held()
    const loading = modelAt(url, options)
    if (waits) {
      // Settled once the scene added the model (`added`), or once its load failed.
      const { promise, resolve: settle } = createDeferred<void>()
      const added: Promise<void> = promise.then(() => void waited.delete(added))
      waited.add(added)
      loading.then((model) => void holding.set(model, settle), settle)
    }
    return loading
  }
  return Object.assign(load, {
    /** The loads a session about to open waits for; none when there are none. */
    loading: () => (waited.size ? Promise.all([...waited]) : undefined),
    /** The scene holds `model` (`Scene.load`): the world hears it, a session waiting for it may
     *  open. */
    added(model: LoadedModel) {
      heard(model)
      holding.get(model)?.()
      holding.delete(model)
    },
  })
}
