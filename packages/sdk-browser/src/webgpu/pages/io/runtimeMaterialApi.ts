import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { HostMaterials } from '../../../host/resources.ts';
import type { Texture } from '../../../../../sdk-core/src/index.ts';
import { surfaceOf } from '../../../page/surface.ts';
import { appendWebgpuTexture, releaseWebgpuTexture } from './appendTexture.ts';

/** Runtime maps join the same colour census and atlas as maps present at open. */
export function runtimeMaterialApi(rt: WebgpuPagesRuntime) {
  return {
    appendTexture: (texture: Texture, kind: 'color' | 'data') =>
      appendWebgpuTexture(rt, texture, kind),
    async admitMaterial(material: HostMaterials) {
      const surface = surfaceOf(material);
      rt.setup.texturePools?.coverage.read(surface);
      if (surface.map) await appendWebgpuTexture(rt, surface.map, 'color');
    },
    releaseMaterial(material: HostMaterials) {
      const map = surfaceOf(material).map;
      if (map) releaseWebgpuTexture(rt, map, 'color');
    },
  };
}
