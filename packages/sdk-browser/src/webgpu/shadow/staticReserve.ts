import { deviceMade } from '../../gpu/core/errorScope.ts';
import { shadowLayerTexture } from '../../gpu/shadow/staticLayer.ts';
import { shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';

/** The static layer's texture, made with the pool and held until the first move builds the layer
 *  on it (`ensureStaticLayer`), per session. */
const reserved = new WeakMap<WebgpuLightState, { texture: GPUTexture; bytes: number }>();

/**
 * Makes the static layer's texture with the pool, in the same held frame, when the shadows' grant
 * holds it (`granted`): as Unreal allocates its static page pool beside the dynamic one, the pool's
 * bytes are then those of its setting from its first frame, whether anything moves or not, and a
 * first move allocates nothing (#831: 188 MB without a mover, 359 MB once one moved). Refused by
 * the device, nothing is held: the first move asks again, as before.
 */
export async function reserveStaticLayer(rt: WebgpuPagesRuntime, granted: boolean) {
  const { lights } = rt,
    device = rt.gpu.device;
  if (!granted || !device || lights.staticLayer || reserved.has(lights)) return;
  const { side, layers } = lights.plan.pool;
  const texture = await deviceMade(device, () => shadowLayerTexture(device, side, layers));
  if (!texture) return;
  if (rt.signal.aborted || lights.staticLayer) return texture.destroy();
  reserved.set(lights, { texture, bytes: shadowAtlasBytes(side, layers) });
  // A session closed before anything moved frees what it reserved.
  rt.signal.addEventListener('abort', () => takeStaticLayerTexture(lights)?.destroy(), {
    once: true,
  });
}

/** The texture reserved with the pool, handed once to the layer the first move builds. */
export function takeStaticLayerTexture(lights: WebgpuLightState) {
  const texture = reserved.get(lights)?.texture;
  reserved.delete(lights);
  return texture;
}

/** GPU bytes of the texture reserved, until a layer takes it. */
export const reservedStaticBytes = (lights: WebgpuLightState) => reserved.get(lights)?.bytes ?? 0;
