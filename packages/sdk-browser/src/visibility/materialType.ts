import type { Texture } from '../../../sdk-core/src/index.ts';

export type VisMaterial = {
  baseColor: [number, number, number];
  metalness: number;
  roughness: number;
  lit: boolean;
  /** False keeps this material's colour outside the scene's fog. */
  fog?: boolean;
  doubleSided: boolean;
  backSide: boolean;
  alphaTest: number;
  map?: Texture;
  metalnessMap?: Texture;
  roughnessMap?: Texture;
  normalMap?: Texture;
  normalScale: number;
  normalScaleY: number;
  /** `normalScaleY` in a frame read from vertex tangents, not rebuilt (`frameNormal.ts`). */
  tangentNormalScaleY?: number;
  aoMap?: Texture;
  aoIntensity: number;
  emissive: [number, number, number];
  subsurfaceColor?: [number, number, number];
  subsurfaceMap?: Texture;
  emissiveMap?: Texture;
  /** `KHR_materials_transmission.transmissionFactor`: the share of the background the surface lets through. */
  anisotropy?: number;
  anisotropyRotation?: number;
  anisotropyMap?: Texture;
  clearcoatMap?: Texture;
  clearcoatRoughnessMap?: Texture;
  clearcoatNormalMap?: Texture;
  clearcoatNormalScale?: readonly [number, number];
  clearcoat?: number;
  clearcoatRoughness?: number;
  transmission: number;
  /** `KHR_materials_ior.ior`, and the volume of `KHR_materials_volume`. `attenuationDistance` is 0
   *  when the glTF does not declare one: the volume then attenuates nothing. */
  ior: number;
  thickness: number;
  attenuationDistance: number;
  attenuationColor: [number, number, number];
  /** The material multiplies its base colour by the geometry's `color` attribute, when it has one. */
  vertexColors?: boolean;
  /** The surface model a non-physical family maps onto (`../scene/surfaceModel.ts`); physical if absent. */
  model?: number;
  /** Width in CSS pixels the rasters widen a line quad to (`shader/lineWgsl.ts`); absent or
   *  zero on a surface that draws triangles. */
  lineWidth?: number;
  /** A dashed line's dash and gap along the line, in world units (`shader/lineWgsl.ts`,
   *  `lineDash`); absent on any other surface. */
  dashSize?: number;
  gapSize?: number;
  /** A sprite's quad, which every raster turns to face the camera (`shader/spriteWgsl.ts`): its
   *  turn in the image in radians, and whether it shrinks with distance; absent on any other
   *  surface. */
  sprite?: { rotation: number; sizeAttenuation: boolean };
};
