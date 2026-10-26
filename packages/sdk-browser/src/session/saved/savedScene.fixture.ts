import { Scene } from '../world/scene.ts'
import type { LoadedModel } from '../world/models/loadedModel.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { light } from '../../../../sdk-core/src/world/light/light.ts'

/** A scene whose `load` stands a plain node in for the compiled model at `url`, carrying one
 *  light from its file as a compiled model does. */
export function sceneWithLoads(loaded: string[]) {
  return new Scene(async (url) => {
    loaded.push(url)
    const lamp = light.point({ intensity: 2 })
    const model = Object.assign(new Object3D(), {
      isLoadedModel: true,
      record: { manifestUrl: url },
      _fromFile: (node: Object3D) => node === lamp,
    })
    model.add(lamp)
    return model as unknown as LoadedModel
  })
}
