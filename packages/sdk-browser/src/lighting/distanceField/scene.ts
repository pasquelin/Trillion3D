import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { createGlobalField, type GlobalFieldFrame } from './globalField.ts'
import { createGlobalPipelines } from './globalPipelines.ts'
import { createMeshFieldScene, type MeshFieldFrame } from './meshFieldScene.ts'
import { globalReadLayoutEntries, type ReadResources } from './view.ts'

/**
 * THE DISTANCE FIELDS OF A SCENE, the one object a session holds: the meshes' fields streamed into
 * their atlas and the placements that use them (`meshFieldScene.ts`), the global distance field
 * composited from them around the camera (`globalField.ts`), and the bindings a program that reads
 * the global field takes (`globalReadWgsl.ts`). A frame calls `update` on its encoder before any
 * pass that reads the field, and `submitted` once the encoder is submitted. While the field is off,
 * or the scene has no placement with a field, the bindings answer as a scene with no distance
 * field does.
 */

/** A frame's inputs: the cut's roots and the camera. */
export type DistanceFieldFrame = MeshFieldFrame &
  Omit<GlobalFieldFrame, 'origin' | 'occlusionDistance'>

/** The distance along an occlusion cone the global field answers for until a consumer sets it: the
 *  reference world's default for the farthest an occlusion reaches, in centimetres. */
export const DEFAULT_OCCLUSION_DISTANCE = 600

/** What the bindings hold while the field has no resources: a table, an atlas and a mip of one texel. */
function createNoField(device: GPUDevice): ReadResources & { destroy(): void } {
  const table = device.createTexture({
    label: 'Trillion3D no global distance field, table',
    dimension: '3d',
    size: [1, 1, 1],
    format: 'r32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const mip = device.createTexture({
    label: 'Trillion3D no global distance field, mip',
    dimension: '3d',
    size: [1, 1, 1],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const atlas = device.createBuffer({
    label: 'Trillion3D no global distance field, atlas',
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  })
  return {
    read: table,
    mip,
    atlas,
    destroy: () => (table.destroy(), mip.destroy(), atlas.destroy()),
  }
}

/** The distance fields of the scene whose meshes' fields are `fields`. */
export function createDistanceFieldScene(device: GPUDevice, fields: readonly MeshDistanceField[]) {
  const pipelines = createGlobalPipelines(device)
  const meshes = createMeshFieldScene(device, fields, pipelines.layouts.scene)
  const field = createGlobalField(device, pipelines)
  const none = createNoField(device)
  let occlusionDistance = DEFAULT_OCCLUSION_DISTANCE
  return {
    /** The meshes' fields the scene was made with. */
    meshes,
    field,
    /** Brings the fields level with the frame and encodes their passes on `encoder`. */
    update(
      encoder: GPUCommandEncoder,
      frame: DistanceFieldFrame,
      settings: GlobalDistanceFieldSettings,
    ) {
      if (!pipelines.ready) return
      const state = meshes.update(encoder, frame, settings)
      field.update(encoder, state, { ...frame, occlusionDistance }, settings)
    },
    /** The farthest an occlusion cone reaches, centimetres: the sky light's occlusion distance, which
     *  its consumer sets before the frame's update. */
    get occlusionDistance() {
      return occlusionDistance
    },
    set occlusionDistance(distance: number) {
      occlusionDistance = distance
    },
    /** After `queue.submit` of the frame's encoder. */
    submitted() {
      meshes.submitted()
      field.submitted()
    },
    /** The layout entries of the reads' bindings from `first`. */
    readLayoutEntries: globalReadLayoutEntries,
    /** The bind group entries of the reads from `first`; they change with `readGeneration`. */
    readEntries: (first: number) => field.readEntries(first, none),
    get readGeneration() {
      return field.generation
    },
    dispose() {
      field.dispose()
      meshes.dispose()
      none.destroy()
    },
  }
}

export type DistanceFieldScene = ReturnType<typeof createDistanceFieldScene>
