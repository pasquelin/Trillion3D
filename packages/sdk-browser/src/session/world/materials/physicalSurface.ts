/**
 * THE SURFACE OF A WORLD'S PHYSICAL KIND: the engine's material parameters (`Material.surface`),
 * declared on a physical surface when it declares a physical field, which it then carries — on a
 * standard one else. A repaint declares it again, so it moves between the two in place: the
 * family is a value like the fields.
 */
import type { Material } from '../../../../../sdk-core/src/world/material/material.ts'
import { contractDeclaration } from '../../host/pageObjects.ts'

/** Physically based fields beyond the engine's parameters, carried on a physical surface. */
const PHYSICAL = [
  'transmission',
  'ior',
  'thickness',
  'anisotropy',
  'anisotropyRotation',
  'clearcoat',
  'clearcoatRoughness',
  'sheen',
  'iridescence',
]

/** Physical fields that only a physical surface carries but that do not make a surface physical by
 *  themselves: the cloth amount of the sheen, which a sheen of zero leaves silent. */
const PHYSICAL_COMPANIONS = ['sheenRoughness']

/** The family of a physical kind: physical when it declares a physical field, standard else. A
 *  declared specular makes it physical whatever its value: a specular of zero is a declaration. */
const physicalFamily = (material: Material) =>
  PHYSICAL.some((field) => typeof material[field] === 'number' && material[field] !== 0) ||
  typeof material.specularIntensity === 'number'
    ? 'physical'
    : 'standard'

/** What a physical kind declares: its parameters, its thin-sheet tint, and on a physical surface
 *  its physical fields. */
export function physicalDeclaration(material: Material, vertexColors: boolean) {
  const family = physicalFamily(material)
  const declared: Record<string, unknown> = {
    ...contractDeclaration(material.surface(), vertexColors),
    family,
    subsurfaceColor: material.subsurfaceColor,
    subsurfaceProfile: material.subsurfaceProfile,
    toonProfile: material.toonProfile,
    shadingModel: material.shadingModel,
    irisMask: material.irisMask,
    irisDistance: material.irisDistance,
    subsurfaceOpacity: material.subsurfaceOpacity,
  }
  if (family !== 'physical') return declared
  if (material.clearcoatNormalScale) declared.clearcoatNormalScale = material.clearcoatNormalScale
  if (material.sheenColor) declared.sheenColor = material.sheenColor
  if (typeof material.specularIntensity === 'number')
    declared.specularIntensity = material.specularIntensity
  for (const field of [...PHYSICAL, ...PHYSICAL_COMPANIONS])
    if (typeof material[field] === 'number') declared[field] = material[field]
  return declared
}
