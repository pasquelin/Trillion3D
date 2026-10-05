import type { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts';
import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { Box3 } from '../../../sdk-core/src/world/math/box3.ts';
import type { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { resolveCameraWorld } from '../camera/world.ts';
import { FLOAT32_STEP } from '../math/matrixElements.ts';

const box = new Box3();

/**
 * Whether `mesh` lies on the rest plane of water at `level`: its world box no thicker, and no
 * farther from the level, than one float32 step at the box's own reach — what the GPU, which draws
 * every world in float32, cannot tell from flat at the level (`poseHoldsBox`'s bound). A plane laid
 * flat by a quarter turn is flat to within the turn's cosine, 6e-17 of its size. A loaded mesh whose
 * vertices are still to read (`VERTICES_NOT_LOADED`) lies nowhere yet.
 */
function liesOnWater(mesh: Mesh, level: number) {
  let local: Box3 | null;
  try {
    local = mesh.localBounds();
  } catch (cause) {
    if ((cause as EngineError).code === 'VERTICES_NOT_LOADED') return false;
    throw cause;
  }
  if (!local || local.isEmpty()) return false;
  resolveCameraWorld(mesh);
  box.copy(local).applyMatrix4(mesh.matrixWorld);
  const { min, max } = box;
  const reach = Math.max(
    Math.abs(level),
    Math.abs(min.x),
    Math.abs(min.y),
    Math.abs(min.z),
    Math.abs(max.x),
    Math.abs(max.y),
    Math.abs(max.z),
  );
  const step = FLOAT32_STEP * reach;
  return (
    max.y - min.y <= step && Math.abs(min.y - level) <= step && Math.abs(max.y - level) <= step
  );
}

/**
 * THE MESHES THE WORLD'S WATER CARRIES (#357). A mesh that lies on the water's rest plane
 * (`liesOnWater`) is that water's drawn surface: its `waves` is set to the world's surface, and the
 * GPU deformation stage moves each of its vertices where the waves carry that rest point — the
 * waves buoyancy reads, on the physics' clock —, with no vertex written on the page. A mesh whose
 * `waves` the page set (a surface, or `null` for none) stays the page's; a body is a body, and a
 * geometry the page rewrites (`usage: 'dynamic'`) has its vertices where the page puts them: neither
 * is water. What the scene tells the physics (`heard`) is read again ahead of the next frame
 * (`frame`): a mesh carried, or no longer, is told its content changed, and is seated again with
 * its waves (`worldBatches.ts`). Every mesh in the world that holds the world's surface, the page's
 * own `mesh.waves = waterSurface` too, is a holder: told when the water set again changes its wave
 * count, which sizes its deformation record, and drawn on while the waves move.
 */
export function createWaterCarry(root: Object3D) {
  /** The one surface of the world's water (`WaterSurface._declare` sets it again in place). */
  let carrier: WaterSurface | null = null,
    /** This frame's surface, null without water: what `read` carries a mesh by. */
    drawn: WaterSurface | null = null,
    /** The wave count the holders were seated with, −1 before any water. */
    count = -1;
  /** The meshes whose `waves` this set; every mesh in the world holding the world's surface. */
  const carried = new Set<Mesh>(),
    holders = new Set<Mesh>(),
    /** Nodes whose subtree moved, changed or was added to since the last frame; the meshes read
     *  this frame, each once however many heard subtrees hold it. */
    heard = new Set<Object3D>(),
    read = new Set<Mesh>();
  const tell = (mesh: Mesh) => mesh._link?.content(mesh);
  const readMesh = (node: Object3D) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || read.has(mesh)) return;
    read.add(mesh);
    // Waves the page wrote over the ones set here — a surface, or `null` for none — are its own.
    if (carried.has(mesh) && mesh.waves !== carrier) carried.delete(mesh);
    const ours = carried.has(mesh);
    if (ours || mesh.waves === undefined) {
      const lies =
        !!drawn &&
        mesh._link === root._link &&
        mesh.primitive === 'triangles' &&
        !(mesh as { isInstancedMesh?: boolean }).isInstancedMesh &&
        !mesh.physics &&
        mesh.geometry.usage !== 'dynamic' &&
        liesOnWater(mesh, drawn.level);
      if (lies !== ours) {
        mesh.waves = lies ? drawn : undefined;
        if (lies) carried.add(mesh);
        else carried.delete(mesh);
        tell(mesh);
      }
    }
    if (carrier && mesh._link === root._link && mesh.waves === carrier) holders.add(mesh);
    else holders.delete(mesh);
  };
  return {
    /** The scene changed under `node` (`physicsLink`): read again ahead of the next frame. */
    heard(node: Object3D) {
      heard.add(node);
    },
    /** The water was set or removed: every mesh is read again. */
    water() {
      heard.clear();
      heard.add(root);
    },
    /**
     * Reads again what changed against `surface`, this frame's (null without water); returns
     * whether a mesh in the world holds it.
     */
    frame(surface: WaterSurface | null) {
      drawn = surface;
      carrier = surface ?? carrier;
      // The count the holders were seated with outlives a frame without water.
      const waves = surface?.waveModel.count ?? count;
      if (count >= 0 && waves !== count) for (const mesh of holders) tell(mesh);
      count = waves;
      for (const node of heard) node.traverse(readMesh);
      heard.clear();
      read.clear();
      // Out of the world, a mesh holds nothing of it: what was set here is taken back.
      for (const mesh of holders) if (mesh._link !== root._link) holders.delete(mesh);
      for (const mesh of carried)
        if (mesh._link !== root._link) {
          carried.delete(mesh);
          mesh.waves = undefined;
        }
      return !!surface && holders.size > 0;
    },
  };
}
