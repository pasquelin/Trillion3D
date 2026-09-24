/**
 * The objects the explorer BUILDS for its host: the camera it frames the scene with, the box and
 * the centre it publishes beside it.
 *
 * Reading a host graph goes through the shapes of `graphNodes.ts`; making one is making an
 * object of that shape, and the engine makes its own (`../graph/`): a camera the host drives
 * with its controls, and a mesh copy sharing the geometry and the surface of the mesh it comes
 * from. Nothing else happens here: every number arrives computed.
 */
import { Box3 } from '../../../../sdk-core/src/world/math/box3.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { GraphCamera } from '../graph/camera.ts';
import { GraphMesh } from '../graph/mesh.ts';
import type { GraphGeometry } from '../graph/geometry.ts';
import type { GraphSurface } from '../graph/surface.ts';
import type { HostBox } from '../resources.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { ControlVector } from '../../camera/controls/types.ts';
import type { HostGraphMesh } from './graphNodes.ts';

/** The camera the explorer frames its scene with, at the optics the framing computed. */
export const hostFramingCamera = (
  fov: number,
  aspect: number,
  near: number,
  far: number,
): HostCamera => new GraphCamera({ fov, aspect, near, far });

/** A point the host reads and its controls aim at: the scene centre, the home offset. */
export const hostPoint = (x: number, y: number, z: number): ControlVector => new Vector3(x, y, z);

/** The world box the explorer publishes, from the six numbers the core computed. */
export const hostBox = (flat: ArrayLike<number>): HostBox =>
  new Box3(new Vector3(flat[0], flat[1], flat[2]), new Vector3(flat[3], flat[4], flat[5]));

/** A copy of `mesh` sharing its geometry and its surface, posed by whoever asked for it:
 *  replication copies transforms alone, and a resource is never rebuilt. */
export const hostMeshCopy = (mesh: HostGraphMesh): HostGraphMesh =>
  new GraphMesh(
    mesh.geometry as unknown as GraphGeometry,
    mesh.material as unknown as GraphSurface | GraphSurface[],
  );
