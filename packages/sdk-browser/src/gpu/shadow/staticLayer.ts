import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { layerPasses, layerViews } from './layers.ts';
import { shadowAtlasBytes } from './atlas.ts';

/** Label of the pass that fills the static layer: timed with the Shadows stage. */
export const SHADOW_LAYER_PASS = 'Trillion3D shadow static layer v1';
/** Label of the pass that fills the static layer of the pages the GPU draws itself (#831). */
export const FRESH_LAYER_PASS = 'Trillion3D shadow GPU page static layer v1';

/** The layout of a static layer's group: one layer of its depth, read by the restore
 *  (`pageQuads.ts`). */
export const staticLayerEntries = (): GPUBindGroupLayoutEntry[] => [
  { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
];

/**
 * THE STATIC LAYER of the shadow pool: a second depth texture of the pool's size, `poolSide` pages
 * a side, where each page keeps the depth of its static casters alone, at the same place. A page
 * whose moving casters changed is restored from it — an instance of the pass's restore draw that
 * writes each texel's depth (`pageQuads.ts`) — and its moving casters drawn over: the static
 * geometry under a moving object is never drawn again for it.
 *
 * It exists from the first move of an object on (`../../webgpu/shadow/mobility.ts`): a scene where
 * nothing moves pays no pass. Its texture is made apart (`shadowLayerTexture`), under an
 * out-of-memory check, with the pool (`../../webgpu/shadow/staticReserve.ts`, #831).
 */
export async function createShadowStaticLayer(device: GPUDevice, texture: GPUTexture) {
  const size = texture.width,
    targets = layerViews(texture);
  try {
    const layout = device.createBindGroupLayout({ entries: staticLayerEntries() });
    return {
      /** Each layer's view: drawn into, restored from, and reduced into the page pyramids. */
      targets,
      passes: layerPasses(SHADOW_LAYER_PASS, targets),
      groups: targets.map((resource) =>
        device.createBindGroup({ layout, entries: [{ binding: 0, resource }] }),
      ),
      bytes: shadowAtlasBytes(size / SHADOW_PAGE, targets.length),
      dispose() {
        texture.destroy();
      },
    };
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

/** The static layer's texture, `poolSide` pages a side in `layers` like the pool it mirrors. */
export const shadowLayerTexture = (device: GPUDevice, poolSide: number, layers: number) =>
  device.createTexture({
    label: 'Trillion3D shadow static layer v1',
    size: [poolSide * SHADOW_PAGE, poolSide * SHADOW_PAGE, layers],
    format: 'depth32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

export type ShadowStaticLayer = Awaited<ReturnType<typeof createShadowStaticLayer>>;
