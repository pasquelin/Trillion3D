import type { HairStrands } from '../../../sdk-core/src/hair/hairStrandsFile.ts'
import { IDENTITY_MATRIX4 } from '../../../math/src/matrix/matrix4.ts'
import { retire } from '../gpu/core/frameRetire.ts'
import { nextPow2 } from '../../../math/src/scalar/integers.ts'
import { frustumExcludesBox } from '../../../math/src/geometry/frustum/box.ts'
import { pixelScale } from '../../../math/src/projection/camera.ts'
import { maximumAxisScale, transformBox, type BoxSphere } from './boxSphere.ts'
import {
  encodeHairBounds,
  HAIR_BOUNDS_FLOATS,
  HAIR_ENTRY_WORDS,
  HAIR_MIN_VOXEL_SIZE,
  type HairBoundsGpu,
  type HairBoundsUpdate,
} from './boundsPass.ts'
import { groomBounds } from './groomBounds.ts'
import { createHairGroup, type HairGroupGpu } from './groupResources.ts'
import type { HairFrameInputs } from './inputs.ts'
import { createMacroGroups, type MacroGroup, type MacroMember } from './macroGroups.ts'
import { hairReachedByLight, hairShadowPlan } from './shadowCasters.ts'
import { encodeHairTangents } from './tangentPass.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

/** One group of strands placed in the world. */
export interface HairInstance extends MacroMember {
  readonly group: HairGroupGpu
  /** Column-major, group space to world. */
  readonly localToWorld: Float64Array
  /** The radius of its greatest strand, in the world. */
  readonly radius: number
  /** The box of the group's points in the world: the bound the voxel volume is made over. */
  readonly box: Float64Array
}

/** The strands of a scene on the GPU: a buffer set for each group, and an instance for each. What
 *  depends on the camera is the view's (`viewGpu.ts`). */
export interface HairScene {
  readonly groups: readonly HairGroupGpu[]
  readonly instances: readonly HairInstance[]
  dispose(): void
}

/** Uploads the groups of `strands` to `device` and places them where the compiler put them (the
 *  strands are in the space of the scene): one instance a group, all with the bounds of the groom.
 *  `readable`, the tangents can be read back (a proof's). */
export function createHairScene(
  device: GPUDevice,
  strands: HairStrands,
  readable = false,
): HairScene {
  const matrix = Float64Array.from(IDENTITY_MATRIX4)
  const bounds: BoxSphere = groomBounds(strands.groups, matrix)
  const scale = maximumAxisScale(matrix)
  const groups: HairGroupGpu[] = []
  try {
    for (const group of strands.groups)
      groups.push(
        createHairGroup(
          device,
          group,
          `${HAIR_STRANDS_PASS_PREFIX}group ${groups.length}`,
          readable ? GPUBufferUsage.COPY_SRC : 0,
        ),
      )
  } catch (error) {
    for (const made of groups) made.destroy()
    throw error
  }
  const instances = groups.map((group, registeredIndex): HairInstance => ({
    registeredIndex,
    group,
    localToWorld: matrix,
    radius: group.maxRadius * scale,
    box: transformBox([...group.boundsMin, ...group.boundsMax], matrix),
    bounds,
    length: group.maxLength,
    supportsVoxelization: true,
  }))
  return {
    groups,
    instances,
    // The commands of an image being encoded may still name the buffers.
    dispose: () =>
      retire(device, {
        destroy() {
          for (const group of groups) group.destroy()
        },
      }),
  }
}

const PIXELS = new Float64Array(2)

/** The world size of a pixel at a distance of 1 from the camera: a perspective projection's, the
 *  tangent of half its vertical field over half its height; an orthographic projection's, at any
 *  distance, its width over the pixels across it. */
export function pixelSizeAtDepth1(
  projection: ArrayLike<number>,
  perspective: number,
  width: number,
  height: number,
) {
  const pixels = pixelScale(PIXELS, projection, width, height)
  return 1 / (perspective ? pixels[1]! : pixels[0]!)
}

/** The instances of a view, told apart: those inside its frustum, which are drawn, and those outside
 *  it that a light reaches (`hairReachedByLight`), which only cast. Refilled each image. */
export interface HairViewLists {
  readonly visible: HairInstance[]
  readonly shadowOnly: HairInstance[]
}

/**
 * Plans an image of `inputs`: the instances inside the frustum, and those outside it that a light
 * that casts reaches (`inputs.shadow`), gathered into macro groups, and the blocks the bounds passes
 * read, written into `update`: every instance's box in the camera's translated world, the instances
 * each macro group lists (those that voxelize) and the camera's block. `lists` is the scratch the
 * instances are told apart in. Returns the macro groups; `update` holds the counts of what it lists.
 */
export function planHairView(
  instances: readonly HairInstance[],
  update: HairBoundsUpdate,
  lists: HairViewLists,
  inputs: HairFrameInputs,
): MacroGroup<HairInstance>[] {
  const { camera, size, shadow } = inputs
  const { visible, shadowOnly } = lists
  visible.length = shadowOnly.length = 0
  const bounds = update.bounds.f
  const reach = shadow && hairShadowPlan(shadow, camera.planes)
  for (const instance of instances) {
    const { box } = instance.bounds
    if (!frustumExcludesBox(camera.planes, box[0]!, box[1]!, box[2]!, box[3]!, box[4]!, box[5]!))
      visible.push(instance)
    else if (reach && hairReachedByLight(instance.bounds, reach)) shadowOnly.push(instance)
    const at = instance.registeredIndex * HAIR_BOUNDS_FLOATS
    for (let axis = 0; axis < 3; axis++) {
      bounds[at + axis] = instance.box[axis]! - camera.eye[axis]!
      bounds[at + 4 + axis] = instance.box[3 + axis]! - camera.eye[axis]!
    }
  }
  const macroGroups = createMacroGroups(visible, shadowOnly, camera, size[0], size[1])
  const { registered, entries } = update
  let listed = 0,
    entryCount = 0
  for (let rank = 0; rank < macroGroups.length; rank++) {
    const group = macroGroups[rank]!
    const first = listed
    for (const member of group.members)
      if (member.supportsVoxelization) registered.u[listed++] = member.registeredIndex
    for (const member of group.shadowMembers)
      if (member.supportsVoxelization) registered.u[listed++] = member.registeredIndex
    if (listed === first) continue
    const at = entryCount++ * HAIR_ENTRY_WORDS
    entries.u[at] = rank
    entries.u[at + 1] = first
    entries.u[at + 2] = listed - first
    entries.u[at + 3] = 0
  }
  update.entryCount = entryCount
  update.registeredCount = listed
  const block = update.camera.words
  for (let k = 0; k < 16; k++) block.f[k] = camera.viewRelative[k]!
  block.f[16] = pixelSizeAtDepth1(camera.projection, camera.perspective, size[0], size[1])
  block.f[17] = inputs.sizeInPixel
  block.u[18] = nextPow2(inputs.pageResolution)
  block.f[19] = HAIR_MIN_VOXEL_SIZE
  block.u[20] = camera.perspective !== 0 ? 1 : 0
  return macroGroups
}

/**
 * Encodes the strands' work for an image on `encoder`, in one compute pass: the tangents of the
 * groups that have none yet, then the instances' bounds and the macro groups' bounds and voxel sizes
 * (`planHairView` wrote what they read). Opens no pass when there is nothing to do.
 */
export function encodeHairScene(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  scene: Pick<HairScene, 'groups'>,
  bounds: HairBoundsGpu,
) {
  let pending = false
  for (const group of scene.groups) pending ||= !group.tangentsWritten
  if (bounds.update.entryCount === 0 && !pending) return
  const pass = encoder.beginComputePass({ label: `${HAIR_STRANDS_PASS_PREFIX}bounds and tangents` })
  for (const group of scene.groups) encodeHairTangents(device, pass, group)
  encodeHairBounds(device, pass, bounds)
  pass.end()
}
