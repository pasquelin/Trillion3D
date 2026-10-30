import { Object3D } from './object3d.ts'
import type { SceneLink } from './sceneLink.ts'
import { Vector3 } from '../math/vector3.ts'
import { boxContainsPoint, boxTransform } from '../../../../math/src/geometry/box.ts'

/**
 * Which bodies of water a volume takes out of the camera's test:
 * - `'allExceptListed'`: every body the volume overlaps but those in `bodies` (so every one when `bodies` is empty);
 * - `'onlyListed'`: only the bodies in `bodies` that the volume overlaps (none when `bodies` is empty).
 */
export type WaterExclusionMode = 'allExceptListed' | 'onlyListed'

/** The volumes of each world, held under the world's link, filled as they enter and leave a world. */
const inWorld = new WeakMap<SceneLink, Set<WaterExclusionVolume>>()
/** The link a volume was filed under. */
const filedUnder = new WeakMap<WaterExclusionVolume, SceneLink>()

/** Scratch point of the box test. */
const point = new Vector3()

/** The unit cube the volume's box is, centred on the node. */
const UNIT_BOX = new Float64Array([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5])

/**
 * A box of the world inside which a water body does not count for the camera: where the camera stands in a volume that excludes a
 * body, the camera is out of that body (a boat's hold, a dry basin dug in a lake). The box is a unit cube centred on the node,
 * stretched by its world scale and turned with it. A volume excludes a body it overlaps, and which bodies follows `mode`; the
 * volume works whether or not it is visible.
 *
 * It is a node: it moves, hangs under another, is copied and saved with the scene (`scene.toJSON`).
 */
export class WaterExclusionVolume extends Object3D {
  /** Always `true`: tells a water exclusion volume apart. */
  readonly isWaterExclusionVolume = true as const
  /** The kind of node, `'WaterExclusionVolume'`. */
  override type = 'WaterExclusionVolume'
  /**
   * Which bodies it excludes, with `bodies`.
   * @defaultValue 'allExceptListed'
   */
  mode: WaterExclusionMode = 'allExceptListed'
  /** The meshes whose water bodies `mode` names: the meshes carrying the water (`mesh.waterBody`), by reference. */
  bodies: Object3D[] = []

  override get _link() {
    return super._link
  }
  override set _link(link: SceneLink | null) {
    const was = filedUnder.get(this)
    if (was) inWorld.get(was)?.delete(this)
    filedUnder.delete(this)
    super._link = link
    if (!link) return
    let held = inWorld.get(link)
    if (!held) inWorld.set(link, (held = new Set()))
    held.add(this)
    filedUnder.set(this, link)
  }

  /** Whether the volume excludes the water body carried by `body`, as far as `mode` and `bodies` go (not whether it overlaps it). */
  excludes(body: Object3D | undefined) {
    const listed = !!body && this.bodies.includes(body)
    return this.mode === 'onlyListed' ? listed : !listed
  }

  /** Whether the world point `(x, y, z)` is inside the box, its faces included. */
  encompasses(x: number, y: number, z: number) {
    this.updateWorldMatrix(true, false)
    point.set(x, y, z)
    this.worldToLocal(point)
    return boxContainsPoint(UNIT_BOX, 0, point.x, point.y, point.z)
  }

  /** Writes the six bounds `[minX, minY, minZ, maxX, maxY, maxZ]` of the box's world extent into `out`. */
  worldBounds(out: Float64Array) {
    this.updateWorldMatrix(true, false)
    boxTransform(out, 0, UNIT_BOX, 0, this.matrixWorld.elements)
    return out
  }

  protected override blank(): this {
    return new WaterExclusionVolume() as this
  }
  override copy(source: Object3D, recursive = true) {
    super.copy(source, recursive)
    const volume = source as WaterExclusionVolume
    if (volume.isWaterExclusionVolume) {
      this.mode = volume.mode
      this.bodies = volume.bodies.slice()
    }
    return this
  }
}

/** The volumes of the world `node` is drawn by, none when it holds none (a read of the node's link, no walk of the tree). */
export const waterExclusionVolumesOf = (node: Object3D | undefined) => {
  const link = node?._link
  return link ? inWorld.get(link) : undefined
}
