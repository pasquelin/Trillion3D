import type { Material } from './material.ts'

/** The kind name of a material of the light function domain (`material.lightFunction`). */
export const LIGHT_FUNCTION_MATERIAL_KIND = 'lightFunction'

/**
 * THE LIGHT FUNCTION DOMAIN is a domain of the engine's one material system (`material.ts`): a
 * material made as `material.lightFunction` gives the colour a light gives at a point, which is its
 * emission — `emissive` times `emissiveIntensity`, times `emissiveMap` read at the light's
 * projection coordinate, as a surface's emission is read. Its other fields are not read. It is
 * drawn once into a slot of the light function atlas, however many lights wear it. No input holds a
 * world position or a depth, which is what makes it drawable once a material and not once a point.
 *
 * A light's record names its material by an id; the materials alive are kept here, by id.
 */
const ALIVE = new Map<string, Material>()
const IDS = new WeakMap<Material, string>()
let made = 0

/** Whether `material` is of the light function domain. */
export const isLightFunctionMaterial = (material: Material) =>
  material.kind === LIGHT_FUNCTION_MATERIAL_KIND

/** The id a light's record names `material` by, given on first use; a material of another domain is
 *  refused (`TypeError`). */
export function lightFunctionIdOf(material: Material): string {
  if (!isLightFunctionMaterial(material))
    throw new TypeError('a light function is a material made by material.lightFunction')
  let id = IDS.get(material)
  if (id === undefined) {
    IDS.set(material, (id = `lightFunction${++made}`))
    ALIVE.set(id, material)
  }
  return id
}

/** Forgets the id of a disposed material: a light that names it has no light function. */
export function forgetLightFunctionMaterial(material: Material) {
  const id = IDS.get(material)
  if (id !== undefined) ALIVE.delete(id)
  IDS.delete(material)
}

/** The live light function material of `id`, if any. */
export const lightFunctionMaterialOf = (id: string) => ALIVE.get(id)
