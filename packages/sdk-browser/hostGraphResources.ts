/**
 * THE HOST RESOURCES A SESSION HOLDS, NAMED BY SHAPE.
 *
 * `hostResources.ts` names what the engine READS of a geometry, a surface or a texture, every
 * field of it read-only, because reading is all a frame does. Three of them are also HELD for the
 * life of a loaded graph: a geometry is asked to compute its box and is given back when the graph
 * is released, a surface is given back the same way, and a texture's sampling quality is raised
 * once to what the device allows. That holding is this file — the read shapes plus the release
 * their host expects and the one field a session writes back — and it is deliberately not in
 * `hostGraphNodes.ts`: a resource is not a node of the graph, it is what the nodes point at.
 */
import type { GpuBuffer } from './clusterBatchMesh.ts';
import type {
  HostAttribute,
  HostDisposable,
  HostGeometry,
  HostMaterial,
  HostTexture,
} from './hostResources.ts';

/** A geometry of the walked graph: the local box it can compute on demand, the index its
 *  triangles are drawn through, and the release its host expects. */
export type HostGraphGeometry = HostGeometry &
  HostDisposable & {
    computeBoundingBox(): void;
    /** Triangle list of the geometry, with what an upload compares to skip a re-copy. */
    readonly index: (HostAttribute & GpuBuffer) | null;
  };

/** A surface of the walked graph: what the engine reads of it, and the release its host expects. */
export type HostGraphMaterial = HostMaterial & HostDisposable;

/** A texture of the walked graph: the host resource itself, released with the surface that
 *  sampled it, and the sampling quality a session raises to what the device allows. */
export type HostGraphTexture = Omit<HostTexture, 'anisotropy'> &
  HostDisposable & {
    anisotropy: number;
    /** Raised when a sampler field changed: what tells the host to upload it again. */
    needsUpdate: boolean;
  };
