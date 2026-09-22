/**
 * THE HOST SURFACE OF A WORLD'S MATERIAL: the family its kind names, built with the host library.
 *
 * A physical kind is the engine's own record (`Material.surface`, `hostPageSurface`), on a
 * physical surface when it declares a physical field. Every other kind is the host family of the
 * same name — basic, Lambert, Phong, toon, normal, matcap, depth —, which the host renderer
 * draws as it is on the WebGL2 path and which the engine maps onto its one lighting model on the
 * WebGPU one (`surfaceModel.ts`). Lines, points and sprites are unlit: they wear a basic surface.
 */
import * as THREE from 'three';
import type { Material } from '../../../sdk-core/world/material/material.ts';
import type { Texture } from '../../../sdk-core/world/texture/texture.ts';
import { hostPageSurface } from '../../hostPageObjects.ts';
import { asHostLibrary } from '../../hostResources.ts';
import { hostSide } from '../../materialSide.ts';

const WRAP = {
  repeat: THREE.RepeatWrapping,
  clamp: THREE.ClampToEdgeWrapping,
  mirror: THREE.MirroredRepeatWrapping,
} as const;
const FILTER: Record<string, THREE.TextureFilter> = {
  nearest: THREE.NearestFilter,
  linear: THREE.LinearFilter,
  nearestMipNearest: THREE.NearestMipmapNearestFilter,
  linearMipNearest: THREE.LinearMipmapNearestFilter,
  nearestMipLinear: THREE.NearestMipmapLinearFilter,
  linearMipLinear: THREE.LinearMipmapLinearFilter,
};
const FORMAT: Record<string, THREE.PixelFormat> = {
  rgba: THREE.RGBAFormat,
  rgb: THREE.RGBFormat,
  r: THREE.RedFormat,
};
/** Material fields that hold a texture, by the name both sides give them. */
export const HOST_MAPS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'alphaMap',
  'aoMap',
  'matcap',
  'gradientMap',
];
/** The maps that hold a colour: the only ones whose sRGB image is decoded. The others hold data —
 *  a direction, a roughness, an occlusion — read as stored whatever the image declares, as the
 *  WebGPU path reads them. */
const COLOUR_MAPS = new Set(['map', 'emissiveMap', 'matcap']);
/** Physically based fields beyond the engine record, carried on a physical host surface. */
const PHYSICAL = [
  'transmission',
  'ior',
  'thickness',
  'clearcoat',
  'clearcoatRoughness',
  'sheen',
  'iridescence',
];

/** The host texture of an engine texture worn in `slot`, its sampler words translated. */
function hostTexture(texture: Texture, slot: string) {
  const pixels = texture.image as { data: ArrayBufferView; width: number; height: number };
  const format = FORMAT[texture.format] ?? THREE.RGBAFormat;
  const host =
    texture.layout === 'data'
      ? new THREE.DataTexture(pixels.data, pixels.width, pixels.height, format)
      : new THREE.Texture(texture.image as THREE.Texture['image']);
  host.wrapS = WRAP[texture.wrapS];
  host.wrapT = WRAP[texture.wrapT];
  host.repeat.set(texture.repeat.x, texture.repeat.y);
  host.offset.set(texture.offset.x, texture.offset.y);
  host.rotation = texture.rotation;
  host.minFilter = FILTER[texture.minFilter] as THREE.MinificationTextureFilter;
  host.magFilter = FILTER[texture.magFilter] as THREE.MagnificationTextureFilter;
  host.colorSpace =
    texture.colorSpace === 'srgb' && COLOUR_MAPS.has(slot)
      ? THREE.SRGBColorSpace
      : THREE.LinearSRGBColorSpace;
  host.flipY = texture.flipY;
  host.anisotropy = texture.anisotropy;
  host.name = texture.name;
  host.needsUpdate = true;
  return host;
}

/** The host family of each kind that is not physical. */
const FAMILY: Record<string, new () => THREE.Material> = {
  meshBasic: THREE.MeshBasicMaterial,
  line: THREE.MeshBasicMaterial,
  lineDashed: THREE.MeshBasicMaterial,
  points: THREE.MeshBasicMaterial,
  sprite: THREE.MeshBasicMaterial,
  shadow: THREE.MeshBasicMaterial,
  meshLambert: THREE.MeshLambertMaterial,
  meshPhong: THREE.MeshPhongMaterial,
  meshToon: THREE.MeshToonMaterial,
  meshNormal: THREE.MeshNormalMaterial,
  meshMatcap: THREE.MeshMatcapMaterial,
  meshDepth: THREE.MeshDepthMaterial,
};
/** Colours a family may carry, written in the linear working space both sides share. */
const COLOURS = ['color', 'emissive', 'specular'];

/** The physical surface: the engine's record, plus the physical fields it does not carry. */
function physicalSurface(material: Material, vertexColors: boolean) {
  let surface = asHostLibrary<THREE.MeshStandardMaterial>(
    hostPageSurface(material.surface(), vertexColors),
  );
  if (PHYSICAL.some((field) => typeof material[field] === 'number' && material[field] !== 0)) {
    const physical = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(physical, surface);
    for (const field of PHYSICAL)
      if (typeof material[field] === 'number')
        Object.assign(physical, { [field]: material[field] });
    surface.dispose();
    surface = physical;
  }
  return surface;
}

/** A non-physical family, its fields written from the material's where the family has them. */
function familySurface(
  Family: new () => THREE.Material,
  material: Material,
  vertexColors: boolean,
) {
  const surface = new Family() as THREE.Material & Record<string, unknown>;
  for (const field of COLOURS) {
    const colour = material[field] as { r: number; g: number; b: number } | undefined;
    const into = surface[field] as THREE.Color | undefined;
    if (colour && into?.isColor) into.setRGB(colour.r, colour.g, colour.b);
  }
  if ((surface.emissive as THREE.Color | undefined)?.isColor)
    (surface.emissive as THREE.Color).multiplyScalar(material.emissiveIntensity);
  if (typeof material.shininess === 'number' && 'shininess' in surface)
    surface.shininess = material.shininess;
  surface.opacity = material.opacity;
  surface.transparent = material.transparent;
  surface.alphaTest = material.alphaTest;
  surface.side = asHostLibrary<THREE.Side>(hostSide(material.side));
  surface.vertexColors = vertexColors;
  return surface;
}

/** The host surface of a world material, with its maps and raster state. */
export function hostSurface(material: Material, vertexColors: boolean) {
  const Family = FAMILY[material.kind];
  const surface = (
    Family ? familySurface(Family, material, vertexColors) : physicalSurface(material, vertexColors)
  ) as THREE.Material & Record<string, unknown>;
  for (const field of HOST_MAPS) {
    const texture = material[field] as Texture | undefined;
    if (texture?.isTexture && field in surface) surface[field] = hostTexture(texture, field);
  }
  if ('flatShading' in surface) surface.flatShading = material.flatShading === true;
  surface.depthWrite = material.depthWrite;
  surface.depthTest = material.depthTest;
  return surface;
}
