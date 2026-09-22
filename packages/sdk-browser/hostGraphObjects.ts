/**
 * The host-library objects the explorer BUILDS for its host: the camera it frames the scene
 * with, the box and the centre it publishes beside it, and the group a replication hangs its
 * copies on.
 *
 * Reading a host graph names no library — the shapes of `hostGraphNodes.ts` are what the walk,
 * the bounds and the poses are written against. MAKING one does: a camera the host will drive
 * with its own controls, and a mesh copy sharing the geometry and the surface of the mesh it
 * comes from, are objects of the library their owner wrote the scene with. That construction
 * is this file, and nothing else happens here: every number arrives computed.
 */
import * as THREE from 'three';
import { asHostLibrary, type HostBox } from './hostResources.ts';
import type { HostCamera } from './cameraWorld.ts';
import type { ControlVector } from './cameraControlTypes.ts';
import type { HostGraphGroup, HostGraphMesh } from './hostGraphNodes.ts';

/** The camera the explorer frames its scene with, at the optics the framing computed. */
export const hostFramingCamera = (
  fov: number,
  aspect: number,
  near: number,
  far: number,
): HostCamera => new THREE.PerspectiveCamera(fov, aspect, near, far);

/** A point the host reads and its controls aim at: the scene centre, the home offset. */
export const hostPoint = (x: number, y: number, z: number): ControlVector =>
  new THREE.Vector3(x, y, z);

/** The world box the explorer publishes, from the six numbers the core computed. */
export const hostBox = (flat: ArrayLike<number>): HostBox =>
  new THREE.Box3(
    new THREE.Vector3(flat[0], flat[1], flat[2]),
    new THREE.Vector3(flat[3], flat[4], flat[5]),
  );

/** The node a replication hangs its copies on: it holds nothing the host wrote. */
export const hostGroup = (): HostGraphGroup => new THREE.Group();

/** A copy of `mesh` sharing its geometry and its surface, posed by whoever asked for it:
 *  replication copies transforms alone, and a host resource is never rebuilt. */
export const hostMeshCopy = (mesh: HostGraphMesh): HostGraphMesh =>
  new THREE.Mesh(
    asHostLibrary<THREE.BufferGeometry>(mesh.geometry),
    asHostLibrary<THREE.Material | THREE.Material[]>(mesh.material),
  );
