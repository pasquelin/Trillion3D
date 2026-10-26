import type { WaterSurface } from '../../../../sdk-core/src/fluids/waterSurface.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/**
 * THE MESHES THAT HOLD THE WORLD'S WATER. The water's drawn surface is the mesh the page links to
 * it: `mesh.waves = world.physics.waterSurface`. The GPU deformation stage then moves each of the
 * mesh's vertices where the waves carry that rest point — the waves buoyancy reads, on the
 * physics' clock —, with no vertex written on the page. Every mesh in the world that holds the
 * world's surface is a holder: told when the water set again changes its wave count, which sizes
 * its deformation record, and drawn on while the waves move. What the scene tells the physics
 * (`heard`) is read again ahead of the next frame (`frame`).
 */
export function createWaterCarry(root: Object3D) {
  /** The one surface of the world's water (`WaterSurface._declare` sets it again in place). */
  let carrier: WaterSurface | null = null,
    /** The wave count the holders were seated with, −1 before any water. */
    count = -1
  const holders = new Set<Mesh>(),
    /** Nodes whose subtree moved, changed or was added to since the last frame. */
    heard = new Set<Object3D>()
  const readMesh = (node: Object3D) => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    if (carrier && mesh._link === root._link && mesh.waves === carrier) holders.add(mesh)
    else holders.delete(mesh)
  }
  return {
    /** The scene changed under `node` (`physicsLink`): read again ahead of the next frame. */
    heard(node: Object3D) {
      heard.add(node)
    },
    /** The water was set or removed: every mesh is read again. */
    water() {
      heard.clear()
      heard.add(root)
    },
    /**
     * Reads again what changed against `surface`, this frame's (null without water); returns
     * whether a mesh in the world holds it.
     */
    frame(surface: WaterSurface | null) {
      carrier = surface ?? carrier
      // The count the holders were seated with outlives a frame without water.
      const waves = surface?.waveModel.count ?? count
      if (count >= 0 && waves !== count) for (const mesh of holders) mesh._link?.content(mesh)
      count = waves
      for (const node of heard) node.traverse(readMesh)
      heard.clear()
      // Out of the world, a mesh holds nothing of it.
      for (const mesh of holders) if (mesh._link !== root._link) holders.delete(mesh)
      return !!surface && holders.size > 0
    },
  }
}
