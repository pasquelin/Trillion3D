import { floorPow2 } from '../../../../math/src/scalar/integers.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import type { AtlasGpu } from './atlasGpu.ts'
import type { AtlasBudget } from './atlasState.ts'
import type { createObjectBuffers } from './objectBuffers.ts'
import { sceneBindGroup } from './sceneBindings.ts'

/** THE PARTS OF THE MESHES' FIELD SCENE that are not its frame (`meshFieldScene.ts`): the budget its
 *  atlas is given by the settings, and the one bind group over its resources. */

/** The atlas's budget as the settings give it, the shape of the atlas — its first two sides and its
 *  blocks — fixed by the first ones read. */
export function createBudget() {
  let fixed: Pick<AtlasBudget, 'sizeXY' | 'blockBricks'> | undefined
  return (settings: GlobalDistanceFieldSettings): AtlasBudget => {
    fixed ??= {
      sizeXY: floorPow2(settings.meshDistanceFieldBrickAtlasSize),
      blockBricks: settings.meshDistanceFieldBlockBricks,
    }
    return {
      ...fixed,
      maxDepth: settings.meshDistanceFieldBrickAtlasDepth,
      uploadBytes: settings.meshDistanceFieldUploadKiB * 1024,
      reverseOrder: settings.meshDistanceFieldReverseAllocation,
    }
  }
}

/** The one bind group over the scene's resources, made again when one of them is. */
export function createSceneGroup(
  device: GPUDevice,
  sceneLayout: GPUBindGroupLayout,
  objects: ReturnType<typeof createObjectBuffers>,
) {
  let group: GPUBindGroup | undefined
  let held: unknown[] = []
  let generation = 0
  return {
    /** How many times the resources the bindings name were made anew. */
    get generation() {
      return generation
    },
    /** The group now over the resources it was made for. */
    get current() {
      return group!
    },
    /** The group over `resources` as they are, made again when one changed: whether it is a new one. */
    over(resources: AtlasGpu) {
      const now = [
        resources.sceneBuffer,
        resources.records.assets,
        resources.records.table,
        resources.brickTexture,
        objects.bounds,
        objects.data,
      ]
      const same = group && now.every((resource, k) => resource === held[k])
      if (!same) {
        generation++
        held = now
        group = sceneBindGroup(device, sceneLayout, resources, objects)
      }
      return !same
    },
  }
}
