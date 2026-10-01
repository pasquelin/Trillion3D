import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { families } from '../host/families.ts';
import type { BackendContext, BackendFactory, EngineRenderer, RenderBackend } from './types.ts';

/** `factory`, marked as the engine's `renderer`: the session reads the mark, never the identity. */
export const engineRenderer = (
  renderer: EngineRenderer,
  factory: (context: BackendContext) => RenderBackend,
): BackendFactory => Object.assign(factory, { renderer });

/** The factory of `renderer`'s family, which has arrived (`loadRenderers`), as a backend. */
const loaded = (renderer: EngineRenderer) =>
  engineRenderer(renderer, (context) => {
    const code = families[renderer].get();
    if (!code)
      throw new EngineError('FAMILY_LOAD_FAILED', `The ${renderer} renderer is not loaded`);
    return code.rendererBackend(context);
  });

/**
 * The engine's two renderers as the core holds them (#1353): each the factory of its family, a
 * chunk a page downloads only when it draws with that renderer. `chooseBackends` names one; the
 * session loads it beside the scene and calls it once it has arrived (`loadRenderers`).
 */
export const engineBackends = { webgpu: loaded('webgpu'), webgl2: loaded('webgl2') };

/** Loads the renderer family of each of `factories` that names one; rejects as a family refusal
 *  does (`FAMILY_LOAD_FAILED`). A witness named by the host loads nothing. */
export const loadRenderers = (factories: readonly BackendFactory[]) =>
  Promise.all(factories.flatMap(({ renderer }) => (renderer ? [families[renderer].load()] : [])));
