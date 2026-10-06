import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import { families } from '../host/families.ts'
import type { BackendContext, RenderBackend } from './types.ts'

/** The engine's own renderer a factory starts; a witness names none. */
export type EngineRenderer = 'webgpu' | 'webgl2'
/** What builds an engine path, marked with its renderer when it is one of the engine's own. */
export type BackendFactory = ((context: BackendContext) => RenderBackend) & {
  readonly renderer?: EngineRenderer
}

/** `factory`, marked as the engine's `renderer`: the session reads the mark, never the identity. */
export const engineRenderer = (
  renderer: EngineRenderer,
  factory: (context: BackendContext) => RenderBackend,
): BackendFactory => Object.assign(factory, { renderer })

/** The factory of `renderer`'s family, which has arrived (`loadRenderers`), as a backend. */
const loaded = (renderer: EngineRenderer) =>
  engineRenderer(renderer, (context) => {
    const code = families[renderer].get()
    if (!code) throw new EngineError('FAMILY_LOAD_FAILED', `The ${renderer} renderer is not loaded`)
    return code.rendererBackend(context)
  })

/**
 * The engine's two renderers as the core holds them: each the factory of its family, a
 * chunk a page downloads only when it draws with that renderer. `chooseBackends` names one; the
 * session loads it beside the scene and calls it once it has arrived (`loadRenderers`).
 */
export const engineBackends = { webgpu: loaded('webgpu'), webgl2: loaded('webgl2') }

/** Loads the renderer family of each of `factories` that names one; rejects as a family refusal
 *  does (`FAMILY_LOAD_FAILED`). A witness named by the host loads nothing. Started beside the
 *  scene and awaited before the engines are built: a session that fails first leaves it unheard. */
export function loadRenderers(factories: readonly BackendFactory[]) {
  const loading = Promise.all(
    factories.flatMap(({ renderer }) => (renderer ? [families[renderer].load()] : [])),
  )
  loading.catch(() => undefined)
  return loading
}
