/**
 * THE RESOURCES A SESSION HOLDS: a surface given back when the graph is released, a texture
 * whose sampling quality is raised once to what the device allows (a geometry is sdk-core's
 * `Geometry`). Each is the engine's own (`../graph/`); this file
 * names them as a session holds them, apart from `graphNodes.ts`: a resource is not a node of
 * the graph, it is what the nodes point at.
 */
import type { GraphSurface } from '../graph/surface.ts';
import type { GraphTexture } from '../graph/texture.ts';

/** A surface of the walked graph. */
export type HostGraphMaterial = GraphSurface;

/** A texture of the walked graph. */
export type HostGraphTexture = GraphTexture;
