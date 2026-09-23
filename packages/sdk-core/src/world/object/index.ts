import { Group, Object3D } from './object3d.ts';
import { Mesh, type Primitive } from './mesh.ts';
import { Geometry } from '../geometry/geometry.ts';
import { plane } from '../geometry/basic.ts';
import { Material } from '../material/material.ts';

/** A mesh reading its geometry as `primitive`, in the material kind a page gets by default. */
const reading =
  (primitive: Primitive, kind: string) =>
  (geometry: Geometry, material: Material = new Material(kind)) =>
    new Mesh(geometry, material, primitive);

/** The `object` family: shape and matter placed in the scene, and the node that groups them. */
export const object = {
  /**
   * Puts a shape and a material together into something the scene can draw.
   * @param geometry - The shape.
   * @param material - The matter, or one per geometry group.
   */
  mesh: (geometry: Geometry, material?: Material | Material[]) =>
    new Mesh(geometry, material ?? new Material('meshBasic')),
  /** An empty node that holds other objects, so they move together. */
  group: () => new Group(),
  /**
   * Draws each vertex of a geometry as a dot.
   * @param geometry - The vertices to draw as dots.
   * @param material - How the dots look.
   */
  points: reading('points', 'points'),
  /**
   * Draws a line through the vertices, one after the other.
   * @param geometry - The vertices to join.
   * @param material - How the line looks.
   */
  line: reading('lineStrip', 'line'),
  /**
   * Draws a separate line for each pair of vertices.
   * @param geometry - The vertices to join two by two.
   * @param material - How the lines look.
   */
  lineSegments: reading('lineSegments', 'line'),
  /**
   * Draws a line through the vertices and back to the first.
   * @param geometry - The vertices to join in a loop.
   * @param material - How the line looks.
   */
  lineLoop: reading('lineLoop', 'line'),
  /**
   * A unit square facing `+z`, in the sprite kind.
   * @param material - What the square shows.
   */
  sprite: (material: Material = new Material('sprite')) =>
    new Mesh(plane(1, 1), material, 'sprite'),
};

export { Object3D, Group, Mesh, type Primitive };
export type { SceneLink } from './object3d.ts';
export { raycast, type Intersection } from './raycast.ts';
