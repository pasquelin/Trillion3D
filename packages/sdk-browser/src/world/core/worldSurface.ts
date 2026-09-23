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
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import { hostPageSurface } from '../../host/pageObjects.ts';
import { asHostLibrary } from '../../host/resources.ts';
import { hostSide } from '../../scene/materialSide.ts';
import { TABLE_SLOTS } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import {
  HOST_FILTER_LINEAR,
  HOST_FILTER_LINEAR_MIP_LINEAR,
  HOST_FILTER_LINEAR_MIP_NEAREST,
  HOST_FILTER_NEAREST,
  HOST_FILTER_NEAREST_MIP_LINEAR,
  HOST_FILTER_NEAREST_MIP_NEAREST,
  HOST_WRAP_CLAMP_TO_EDGE,
  HOST_WRAP_MIRRORED_REPEAT,
  HOST_WRAP_REPEAT,
} from '../../host/surfaceConstants.ts';

const WRAP = {
  repeat: HOST_WRAP_REPEAT,
  clamp: HOST_WRAP_CLAMP_TO_EDGE,
  mirror: HOST_WRAP_MIRRORED_REPEAT,
} as const;
const FILTER = {
  nearest: HOST_FILTER_NEAREST,
  linear: HOST_FILTER_LINEAR,
  nearestMipNearest: HOST_FILTER_NEAREST_MIP_NEAREST,
  linearMipNearest: HOST_FILTER_LINEAR_MIP_NEAREST,
  nearestMipLinear: HOST_FILTER_NEAREST_MIP_LINEAR,
  linearMipLinear: HOST_FILTER_LINEAR_MIP_LINEAR,
} as const;
const FORMAT: Record<string, THREE.PixelFormat> = {
  rgba: THREE.RGBAFormat,
  rgb: THREE.RGBFormat,
  r: THREE.RedFormat,
};
/** Material fields that hold a texture, by the name both sides give them. */
export const HOST_MAPS = [...TABLE_SLOTS, 'alphaMap', 'matcap', 'gradientMap'];
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

/** Host textures already built, by engine texture, its version and whether it is read as colour:
 *  a texture worn by several surfaces is uploaded once. */
export type HostTextures = Map<string, THREE.Texture>;

/** Writes how a host texture samples — addressing, placement of the picture, filters — unless it
 *  already holds this version of the world texture: a repaint of a colour uploads nothing. */
function writeHostSampling(host: THREE.Texture, texture: Texture) {
  if (host.userData.sampledVersion === texture.version) return;
  host.userData.sampledVersion = texture.version;
  host.wrapS = WRAP[texture.wrapS];
  host.wrapT = WRAP[texture.wrapT];
  host.repeat.set(texture.repeat.x, texture.repeat.y);
  host.offset.set(texture.offset.x, texture.offset.y);
  host.rotation = texture.rotation;
  host.minFilter = FILTER[texture.minFilter] as THREE.MinificationTextureFilter;
  host.magFilter = FILTER[texture.magFilter] as THREE.MagnificationTextureFilter;
  host.anisotropy = texture.anisotropy;
  host.needsUpdate = true;
}

/** The host texture of an engine texture, read as colour or as data; built once per table. */
function hostTexture(texture: Texture, colour: boolean, built: HostTextures) {
  const key = `${texture.id}@${texture.version}:${colour}`;
  const held = built.get(key);
  if (held) return held;
  const pixels = texture.image as { data: ArrayBufferView; width: number; height: number };
  const format = FORMAT[texture.format] ?? THREE.RGBAFormat;
  const host =
    texture.layout === 'data'
      ? new THREE.DataTexture(pixels.data, pixels.width, pixels.height, format)
      : new THREE.Texture(texture.image as THREE.Texture['image']);
  writeHostSampling(host, texture);
  host.colorSpace =
    texture.colorSpace === 'srgb' && colour ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  host.flipY = texture.flipY;
  host.name = texture.name;
  built.set(key, host);
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
export function hostSurface(material: Material, vertexColors: boolean, textures: HostTextures) {
  const Family = FAMILY[material.kind];
  const surface = (
    Family ? familySurface(Family, material, vertexColors) : physicalSurface(material, vertexColors)
  ) as THREE.Material & Record<string, unknown>;
  for (const field of HOST_MAPS) {
    const texture = material[field] as Texture | undefined;
    if (texture?.isTexture && field in surface)
      surface[field] = hostTexture(texture, COLOUR_MAPS.has(field), textures);
  }
  if ('flatShading' in surface) surface.flatShading = material.flatShading === true;
  surface.depthWrite = material.depthWrite;
  surface.depthTest = material.depthTest;
  return surface;
}

/**
 * Writes a material's value fields — colour, glow, metalness, roughness — and its maps' sampling
 * into the host surface built for it, as `hostSurface` wrote them, and bumps the versions: every
 * reader of the surface (`page/surface.ts`) takes them at its next read, nothing built again (#335).
 */
export function repaintHostSurface(surface: THREE.Material, material: Material) {
  const into = surface as THREE.Material & Record<string, unknown>;
  for (const field of HOST_MAPS) {
    const texture = material[field] as Texture | undefined,
      host = into[field] as THREE.Texture | null | undefined;
    if (texture?.isTexture && host?.isTexture) writeHostSampling(host, texture);
  }
  const { color, emissive } = material;
  (into.color as THREE.Color | undefined)?.setRGB(color.r, color.g, color.b);
  (into.emissive as THREE.Color | undefined)
    ?.setRGB(emissive.r, emissive.g, emissive.b)
    .multiplyScalar(material.emissiveIntensity);
  if (typeof into.metalness === 'number') into.metalness = material.metalness;
  if (typeof into.roughness === 'number') into.roughness = material.roughness;
  surface.needsUpdate = true;
}
