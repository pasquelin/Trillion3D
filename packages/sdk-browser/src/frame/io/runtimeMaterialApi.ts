import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { appendWebgpuTexture, releaseWebgpuTexture } from './appendTexture.ts'
import { restackMaterial } from './restack.ts'
import type { PageMaterials } from '../../geometry/pages/pageMesh.ts'

/** Runtime maps join the same colour census and atlas as maps present at open. */
export function runtimeMaterialApi(rt: WebgpuPagesRuntime) {
  return {
    appendTexture: (texture: Texture, kind: 'color' | 'data') =>
      appendWebgpuTexture(rt, texture, kind),
    async admitMaterial(material: PageMaterials) {
      const surface = surfaceOf(material)
      if (surface.map) await appendWebgpuTexture(rt, surface.map, 'color')
      restackMaterial(rt, surface)
    },
    releaseMaterial(material: PageMaterials) {
      const map = surfaceOf(material).map
      if (map) releaseWebgpuTexture(rt, map, 'color')
    },
  }
}
