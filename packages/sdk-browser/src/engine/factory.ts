import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import { families } from '../host/families.ts'
import type { Engine, EngineContext } from './types.ts'

/** The engine's id, its WebGPU page raster's: what a report and its stage profile name it by. */
export const WEBGPU_ENGINE_ID = 'webgpu-page-raster'

/** What builds the engine from the session's context: `webgpuEngine`, or the factory a measured
 *  page hands the session (`MeasuredWorldOptions.engine`). */
export type EngineFactory = (context: EngineContext) => Engine

/**
 * The engine as the core holds it (#1353): its renderer is a family, a chunk the page downloads
 * beside the scene so neither waits for the other (`loadEngine`), and this factory builds through
 * it once it has arrived. A session handed its engine (`MeasuredWorldOptions.engine`) loads none.
 */
export const webgpuEngine: EngineFactory = (context) => {
  const code = families.webgpu.get()
  if (!code) throw new EngineError('FAMILY_LOAD_FAILED', 'The WebGPU renderer is not loaded')
  return code.createEngine(context)
}

/** Starts the renderer family; rejects as a family refusal does (`FAMILY_LOAD_FAILED`). Awaited
 *  before the engine is built: a session that fails first leaves it unheard. */
export function loadEngine() {
  const loading = families.webgpu.load()
  loading.catch(() => undefined)
  return loading
}
