import { BufferAttribute } from '../buffer/index.ts';
import { Geometry } from './geometry.ts';
import { box, circle, cone, cylinder, plane, ring, sphere } from './basic.ts';
import { capsule, lathe, torus, torusKnot, tube } from './round.ts';
import { extrude, shape, type ExtrudeOptions } from './shape.ts';
import { polyhedron } from './polyhedron.ts';
import { edges, wireframe } from './lines.ts';

/**
 * The `geometry` family: the shape alone, with no matter. Every member builds a `Geometry` of
 * named attributes (`position`, `normal`, `uv`, `color`) and a triangle index.
 */
export const geometry = {
  box,
  sphere,
  cylinder,
  cone,
  torus,
  torusKnot,
  plane,
  circle,
  ring,
  capsule,
  lathe,
  extrude,
  tube,
  shape,
  polyhedron,
  edges,
  wireframe,
  /**
   * A geometry written by hand, attribute by attribute.
   * @param attributes - The per-vertex lists by name, and the optional `index`.
   */
  createBuffer(attributes: {
    position: BufferAttribute;
    normal?: BufferAttribute;
    uv?: BufferAttribute;
    color?: BufferAttribute;
    index?: BufferAttribute;
  }) {
    const built = new Geometry();
    for (const [name, attribute] of Object.entries(attributes))
      if (attribute && name !== 'index') built.setAttribute(name, attribute);
    if (attributes.index) built.setIndex(attributes.index);
    return built;
  },
};

export { Geometry, type ExtrudeOptions };
