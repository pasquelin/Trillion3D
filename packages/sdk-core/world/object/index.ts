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
  mesh: (geometry: Geometry, material?: Material | Material[]) =>
    new Mesh(geometry, material ?? new Material('meshBasic')),
  group: () => new Group(),
  points: reading('points', 'points'),
  line: reading('lineStrip', 'line'),
  lineSegments: reading('lineSegments', 'line'),
  lineLoop: reading('lineLoop', 'line'),
  /** A unit square facing `+z`, in the sprite kind. */
  sprite: (material: Material = new Material('sprite')) =>
    new Mesh(plane(1, 1), material, 'sprite'),
};

export { Object3D, Group, Mesh, type Primitive };
export type { SceneLink } from './object3d.ts';
