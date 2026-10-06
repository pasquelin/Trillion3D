import { createSceneLightStore } from '../../../sdk-core/src/index.ts'
import { attachContractLights } from './contractLights.ts'
import { installLighting } from './contractLightingApi.ts'
import { createDrawLists } from '../webgl/cluster/drawLists.ts'
import { Scene } from '../world/core/scene.ts'
import { Light } from '../../../sdk-core/src/world/light/light.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

/** A source light of the given kind and strength. */
export const light = (kind: string, intensity = 1) => new Light(kind, { intensity })

/** A WebGL2 engine, reduced to what the contract asks of it: its scene and its source graph. */
export function harness(sourceLights: Object3D[] = []) {
  const [scene, source, store] = [new Scene(), new Object3D(), createSceneLightStore()]
  source.add(...sourceLights)
  const lighting = installLighting(scene, 0, source)
  const contract = attachContractLights(scene, store, lighting, () => {})
  return {
    scene,
    source,
    lighting,
    store,
    contract,
    /** Lights the render would see: the list a WebGL2 frame reads (`drawLists.ts`). */
    visibleLights() {
      const lists = createDrawLists(scene, [])
      lists.refresh()
      const found = [...lists.lights]
      lists.dispose()
      return found
    },
  }
}
