/**
 * THE SURFACE OF A WORLD'S PHYSICAL KIND: the engine's own record (`Material.surface`), on a
 * physical surface when it declares a physical field, which it then carries — on a standard one
 * else. A repaint moves it between the two in place (#572): the family is a value like the fields.
 */
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { hostPageSurface } from '../../host/pageObjects.ts';
import type { GraphSurface } from '../../host/graph/surface.ts';
import { extensions } from '../../host/graph/surfaceFields.ts';

/** Physically based fields beyond the engine record, carried on a physical surface. */
const PHYSICAL = [
  'transmission',
  'ior',
  'thickness',
  'clearcoat',
  'clearcoatRoughness',
  'sheen',
  'iridescence',
];

/** The family of a physical kind: physical when it declares a physical field, standard else. */
const physicalFamily = (material: Material) =>
  PHYSICAL.some((field) => typeof material[field] === 'number' && material[field] !== 0)
    ? 'physical'
    : 'standard';

/** Writes a physical kind's family and physical fields into its surface: a surface that moves
 *  to the physical family takes its extensions first, at the reference's values. */
export function writePhysical(surface: GraphSurface, material: Material) {
  const family = physicalFamily(material);
  if (family === 'physical' && surface.family !== family) Object.assign(surface, extensions());
  surface.family = family;
  if (family === 'physical')
    for (const field of PHYSICAL)
      if (typeof material[field] === 'number') surface[field] = material[field];
}

/** The surface of a physical kind, in the family its fields put it in. */
export function physicalSurface(material: Material, vertexColors: boolean) {
  const surface = hostPageSurface(material.surface(), vertexColors, physicalFamily(material));
  writePhysical(surface, material);
  return surface;
}
