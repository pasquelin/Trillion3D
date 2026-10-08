/**
 * THE SURFACE OF THE ENGINE'S OWN GRAPH A MATERIAL MADE AT RUN TIME IS HELD AS.
 *
 * A material the page creates or repaints is a surface of the engine's own graph (`graph/`);
 * callers hold it through the shapes of `resources.ts`. Nothing is decided here: the surface
 * parameters all arrive computed.
 */
import type { Material } from '../../../sdk-core/src/index.ts'
import type { HostMaterial } from './resources.ts'
import { hostSide } from '../scene/materialSide.ts'
import { GraphSurface } from './graph/surface.ts'
import { alphaModeFields } from './prepared/materials.ts'

/** The standard surface the engine's material parameters describe; a world moves it to the
 *  physical family (`../world/core/worldPhysicalSurface.ts`). The face constant is the engine's
 *  (`../scene/materialSide.ts`), the alpha mode drawn by the open's one rule (`alphaModeFields`);
 *  nothing else is converted. */
export function hostPageSurface(material: Material, vertexColors: boolean) {
  const [r, g, b] = material.baseColor,
    [er, eg, eb] = material.emissive
  return new GraphSurface('standard', {
    color: { r, g, b },
    emissive: { r: er, g: eg, b: eb },
    metalness: material.metalness,
    roughness: material.roughness,
    opacity: material.opacity,
    ...alphaModeFields(material.alphaMode, material.alphaCutoff),
    side: hostSide(material.side),
    vertexColors,
  }) as unknown as GraphSurface & HostMaterial
}
