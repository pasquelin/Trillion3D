/**
 * THE SURFACE OF THE ENGINE'S MATERIAL PARAMETERS: what a material a page creates, or a world's
 * physical kind, declares. Nothing is decided here: the parameters all arrive computed.
 */
import type { Material } from '../../../sdk-core/src/contracts/material.ts'
import { declareSurface } from '../page/surfaceRecord.ts'
import type { SurfaceDeclaration } from '../page/surfaceDeclaration.ts'
import { alphaModeFields } from './prepared/materials.ts'

/** The standard surface the engine's material parameters declare; a world moves it to the
 *  physical family (`../world/core/worldSurface.ts`). The alpha mode is drawn by the open's one
 *  rule (`alphaModeFields`); nothing else is converted. */
export function contractDeclaration(material: Material, vertexColors: boolean) {
  const [r, g, b] = material.baseColor,
    [er, eg, eb] = material.emissive
  return {
    family: 'standard',
    color: { r, g, b },
    emissive: { r: er, g: eg, b: eb },
    metalness: material.metalness,
    roughness: material.roughness,
    opacity: material.opacity,
    ...alphaModeFields(material.alphaMode, material.alphaCutoff),
    side: material.side,
    vertexColors,
  } satisfies SurfaceDeclaration
}

/** The record of `material`'s parameters. */
export const materialSurface = (material: Material, vertexColors: boolean) =>
  declareSurface(contractDeclaration(material, vertexColors))
