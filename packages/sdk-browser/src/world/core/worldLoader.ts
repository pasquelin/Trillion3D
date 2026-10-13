import type { LoadOptions } from './scene.ts'
import { loadModel, type LoadedModel } from './loadedModel.ts'
import { loadModelOfAnyFormat } from './modelFormat.ts'
import type { PageCache } from '../../streaming/pageCache.ts'

/**
 * The one door for every model a world's scene loads: its format is read from its content, then
 * its loader — today the compiled manifest's alone — reads it (`modelFormat.ts`), once the world
 * holds its device. A world that draws nothing yet opens its first session once the models asked
 * for meanwhile are in its scene (`loading`): one session opens on all of them. The first of them
 * leaves its baked images to the cache, the levels only the session opened on it reads; every
 * other model reads its images. A world already holding a session (`held`) waits for nothing: a
 * model it loads joins that session in place (`worldModelJoin.ts`).
 */
export function worldModelLoader(
  ready: Promise<unknown>,
  signal: AbortSignal | undefined,
  /** The world's page cache, which its models and sessions read through. */
  pageCache: PageCache,
  /** Whether a session is open or opening: it can no more be based on a model not yet loaded. */
  held: () => boolean = () => false,
) {
  let models = 0
  /** The loads a session not yet opened waits for, each settled once its model is in the scene. */
  const waited = new Set<Promise<void>>()
  /** What settles each of those once the scene says it holds the model (`added`). */
  const holding = new Map<LoadedModel, () => void>()
  const load = async (url: string, options: LoadOptions) => {
    const waits = !held(),
      cached = models++ === 0 && waits
    const read = {
      scope: options.scope === undefined ? undefined : options.scope === 'full' ? 'full' : 'slice',
      signal: options.signal ?? signal,
      onProgress: options.onProgress,
      textureSource: cached ? 'cache' : 'host',
      pageCache,
    } as const
    const loading = ready.then(() => loadModelOfAnyFormat(url, read, { manifest: loadModel }))
    if (waits) {
      // Settled once the scene added the model (`added`), or once its load failed.
      let settle!: () => void
      const added: Promise<void> = new Promise<void>((done) => (settle = done)).then(
        () => void waited.delete(added),
      )
      waited.add(added)
      loading.then((model) => void holding.set(model, settle), settle)
    }
    return loading
  }
  return Object.assign(load, {
    /** The loads a session about to open waits for; none when there are none. */
    loading: () => (waited.size ? Promise.all([...waited]) : undefined),
    /** The scene holds `model` (`Scene.load`): a session waiting for it may open. */
    added(model: LoadedModel) {
      holding.get(model)?.()
      holding.delete(model)
    },
  })
}
