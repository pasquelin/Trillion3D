/**
 * THE RESOURCES A SESSION HOLDS: a geometry asked to compute its box and given back when the
 * graph is released, a surface given back the same way, a texture whose sampling quality is
 * raised once to what the device allows. Each is the engine's own (`../graph/`); this file
 * names them as a session holds them, apart from `graphNodes.ts`: a resource is not a node of
 * the graph, it is what the nodes point at.
 */
import type { GraphGeometry } from '../graph/geometry.ts';
import type { GraphSurface } from '../graph/surface.ts';
import type { GraphTexture } from '../graph/texture.ts';

/** A geometry of the walked graph. */
export type HostGraphGeometry = GraphGeometry;

/** A surface of the walked graph. */
export type HostGraphMaterial = GraphSurface;

/** A texture of the walked graph. */
export type HostGraphTexture = GraphTexture;
