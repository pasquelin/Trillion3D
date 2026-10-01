import { deviceMade } from '../../gpu/core/errorScope.ts';
import { shadowLayerTexture } from '../../gpu/shadow/staticLayer.ts';
import { shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';

/**
 * Makes the static layer's texture with the pool, in the same held frame, when the shadows' grant
 * holds it (`granted`): as the reference engine allocates its static page pool beside the dynamic one, the pool's
 * bytes are then those of its setting from its first frame, whether anything moves or not, and a
 * first move allocates nothing (#831: 188 MB without a mover, 359 MB once one moved). Refused by
 * the device, nothing is held: the first move asks again, as before. The light state owns it
 * (`staticLayerTexture`), freed with the layer (`disposeStaticLayer`).
 */
export async function reserveStaticLayer(rt: WebgpuPagesRuntime, granted: boolean) {
  const { lights } = rt,
    device = rt.gpu.device;
  if (!granted || !device || lights.staticLayer || lights.staticLayerTexture) return;
  const { side, layers } = lights.plan.pool;
  const texture = await deviceMade(device, () => shadowLayerTexture(device, side, layers));
  if (!texture) return;
  if (rt.signal.aborted || lights.staticLayer || lights.staticLayerTexture)
    return texture.destroy();
  lights.staticLayerTexture = texture;
}

/** GPU bytes of the texture reserved, held until the layer built on it owns it and counts them
 *  itself (`shadowPoolHeld`). */
export const reservedStaticBytes = (lights: WebgpuLightState) =>
  lights.staticLayerTexture ? shadowAtlasBytes(lights.plan.pool.side, lights.plan.pool.layers) : 0;
