import type { LoadOptions } from './scene.ts'
import { loadModel } from './loadedModel.ts'
import { loadModelOfAnyFormat } from './modelFormat.ts'

/**
 * The one door for every model a world's scene loads: its format is read from its content, then
 * its loader — today the compiled manifest's alone — reads it (`modelFormat.ts`), once the world
 * holds its device. The first model leaves its baked images to the cache; the engine reads the
 * whole manifest until its session grows in place (#216).
 */
export function worldModelLoader(ready: Promise<unknown>, signal: AbortSignal | undefined) {
  let models = 0
  return async (url: string, load: LoadOptions) => {
    await ready
    const read = {
      scope: load.scope === undefined ? undefined : load.scope === 'full' ? 'full' : 'slice',
      signal: load.signal ?? signal,
      onProgress: load.onProgress,
      textureSource: models++ === 0 ? 'cache' : 'host',
    } as const
    return loadModelOfAnyFormat(url, read, { manifest: loadModel })
  }
}
