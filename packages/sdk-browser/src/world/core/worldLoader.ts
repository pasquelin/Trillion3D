import type { LoadOptions } from './scene.ts';
import { loadModel } from './loadedModel.ts';
import { loadModelOfAnyFormat } from '../loader/modelFormat.ts';
import type { WorldRenderer } from '../capability/worldReady.ts';

/**
 * The one door for every model a world's scene loads: its format is read from its content, then
 * its loader — today the compiled manifest's alone — reads it (`modelFormat.ts`), once the world
 * knows how it draws. The first model of a WebGPU world leaves its baked images to the cache.
 */
export function worldModelLoader(
  ready: Promise<unknown>,
  signal: AbortSignal | undefined,
  renderer: () => WorldRenderer | null,
) {
  let models = 0;
  return async (url: string, load: LoadOptions) => {
    await ready;
    const read = {
      scope: load.scope === undefined ? undefined : load.scope === 'full' ? 'full' : 'slice',
      signal: load.signal ?? signal,
      onProgress: load.onProgress,
      textureSource: renderer() === 'webgpu' && models++ === 0 ? 'cache' : 'host',
    } as const;
    return loadModelOfAnyFormat(url, read, { manifest: loadModel });
  };
}
