import type { Geometry } from './geometry.ts';
import { box, circle, cone, cylinder, plane, ring, sphere } from './basic.ts';
import { capsule, torus, torusKnot } from './round.ts';

/** The members that stamp their geometry with the call that built it (`withRecipe`), by the
 *  name the recipe stores: what a saved scene builds a shape again with. */
export const RECIPES: Readonly<Record<string, (...args: never[]) => Geometry>> = {
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
};
