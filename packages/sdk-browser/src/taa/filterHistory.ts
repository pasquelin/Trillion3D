import { FILTER_FORMAT } from '../webgpu/blend/displayFilter.ts';
import { TAA_BINDINGS } from './shaderWgsl.ts';

/** The display layers, the tint and the added value (`../webgpu/blend/displayFilter.ts`). */
export type DisplayLayers = readonly [GPUTextureView, GPUTextureView];

/**
 * The display layers' two history pairs (`../webgpu/blend/displayFilter.ts`), in ping-pong with
 * the colour's: made by the first image that resolves a filter, dropped with the display filter
 * (`../webgpu/pages/render/encodeDisplayFilter.ts`) or the colour's targets, so a scene without a
 * filtering blend keeps no byte of them. An image that resolves none keeps them for the next.
 */
export function createTaaFilterHistory(device: GPUDevice) {
  const textures: GPUTexture[] = [],
    views: DisplayLayers[] = [];
  let saved = false;
  const drop = () => {
    for (const texture of textures) texture.destroy();
    textures.length = views.length = 0;
    history.written = false;
  };
  const history = {
    /** The target read next holds the last image's filter: what `params.w` tells the resolve. */
    written: false,
    get bytes() {
      return textures.reduce((sum, texture) => sum + texture.width * texture.height * 4, 0);
    },
    /** Made for the first image that resolves `filter`. */
    follow(filter: DisplayLayers | undefined, width: number, height: number) {
      if (!filter) return;
      const layer = (label: string) => {
        const texture = device.createTexture({
          label: `Trillion3D TAA display ${label}`,
          size: { width, height },
          format: FILTER_FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        textures.push(texture);
        return texture.createView();
      };
      for (let i = views.length; i < 2; i++)
        views.push([layer(`tint ${i}`), layer(`added value ${i}`)]);
    },
    /** The bindings of the group that reads history `rank`: none without a filter. */
    entries: (filter: DisplayLayers | undefined, rank: number): GPUBindGroupEntry[] =>
      filter
        ? [
            { binding: TAA_BINDINGS.filterNow, resource: filter[0] },
            { binding: TAA_BINDINGS.filterHistory, resource: views[rank][0] },
            { binding: TAA_BINDINGS.addNow, resource: filter[1] },
            { binding: TAA_BINDINGS.addHistory, resource: views[rank][1] },
          ]
        : [],
    /** The targets history `rank` is written through, when the image resolves a filter. */
    target: (rank: number): DisplayLayers | undefined => views[rank],
    /** A convergence image replays the history the image it remakes read (`checkpoint`). */
    checkpoint: () => void (saved = history.written),
    replay: () => void (history.written = saved),
    drop,
  };
  return history;
}
