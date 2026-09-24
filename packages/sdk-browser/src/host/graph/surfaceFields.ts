/**
 * The fields of the surface families (`surface.ts`), grouped as the reference groups them, at
 * the values it gives a surface a scene leaves them unsaid.
 */
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts';
import {
  HOST_BLENDING_NORMAL,
  HOST_DEPTH_LESS_EQUAL,
  HOST_NORMAL_MAP_TANGENT_SPACE,
} from '../surfaceConstants.ts';
import { hostSide } from '../../scene/materialSide.ts';

/** The raster state every family carries, at the reference's values. */
export const raster = () => ({
  visible: true,
  side: hostSide('front'),
  vertexColors: false,
  opacity: 1,
  transparent: false,
  alphaHash: false,
  alphaTest: 0,
  blending: HOST_BLENDING_NORMAL,
  premultipliedAlpha: false,
  alphaToCoverage: false,
  depthFunc: HOST_DEPTH_LESS_EQUAL,
  depthTest: true,
  depthWrite: true,
  colorWrite: true,
  stencilWrite: false,
  clippingPlanes: null,
  polygonOffset: false,
  polygonOffsetFactor: 0,
  polygonOffsetUnits: 0,
  forceSinglePass: false,
  toneMapped: true,
});
/** A base colour and the maps an unlit surface samples. */
export const coloured = () => ({
  color: new Color().setRGB(1, 1, 1),
  map: null,
  lightMap: null,
  aoMap: null,
  aoMapIntensity: 1,
  alphaMap: null,
  envMap: null,
  wireframe: false,
});
/** The relief a shaded surface reads: bump, normal and displacement maps. */
export const relief = () => ({
  bumpMap: null,
  normalMap: null,
  normalMapType: HOST_NORMAL_MAP_TANGENT_SPACE,
  normalScale: new Vector2(1, 1),
  displacementMap: null,
  flatShading: false,
});
/** The light a surface gives off by itself. */
export const glow = () => ({
  emissive: new Color().setRGB(0, 0, 0),
  emissiveIntensity: 1,
  emissiveMap: null,
});
/** The metal-rough model's factors and maps. */
export const metalRough = () => ({
  roughness: 1,
  metalness: 0,
  roughnessMap: null,
  metalnessMap: null,
});
/** The physical extensions, silent. */
export const extensions = () => ({
  anisotropy: 0,
  anisotropyRotation: 0,
  anisotropyMap: null,
  clearcoat: 0,
  clearcoatMap: null,
  clearcoatRoughness: 0,
  clearcoatRoughnessMap: null,
  clearcoatNormalScale: new Vector2(1, 1),
  clearcoatNormalMap: null,
  dispersion: 0,
  ior: 1.5,
  iridescence: 0,
  iridescenceMap: null,
  iridescenceIOR: 1.3,
  iridescenceThicknessRange: [100, 400],
  iridescenceThicknessMap: null,
  sheen: 0,
  sheenColor: new Color().setRGB(0, 0, 0),
  sheenColorMap: null,
  sheenRoughness: 1.0,
  sheenRoughnessMap: null,
  transmission: 0,
  transmissionMap: null,
  thickness: 0,
  thicknessMap: null,
  attenuationDistance: Infinity,
  attenuationColor: new Color().setRGB(1, 1, 1),
  specularIntensity: 1,
  specularIntensityMap: null,
  specularColor: new Color().setRGB(1, 1, 1),
  specularColorMap: null,
});
