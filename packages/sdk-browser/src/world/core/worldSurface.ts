/**
 * THE SURFACE OF A WORLD'S MATERIAL: the family its kind names, as the engine's own surface.
 *
 * A physical kind is the engine's own record (`Material.surface`), on a physical surface when it
 * declares a physical field. Every other kind is the family of the same name — basic, Lambert,
 * Phong, toon, normal, matcap, depth —, which the engine maps onto its one lighting model on the
 * WebGPU path (`surfaceModel.ts`) and a renderer of the reference library draws as it is
 * (`bench/witnesses/three/fromGraph.ts`). Lines, points and sprites are unlit: they wear a basic surface.
 */
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { hostSide } from '../../scene/materialSide.ts';
import { TABLE_SLOTS } from '../../../../sdk-core/src/scene/core/tableSurfaces.ts';
import { GraphSurface, type GraphSurfaceFamily } from '../../host/graph/surface.ts';
import { GraphTexture } from '../../host/graph/texture.ts';
import {
  HOST_COLOUR_SPACE_LINEAR,
  HOST_COLOUR_SPACE_SRGB,
  HOST_FILTER_LINEAR,
  HOST_FILTER_LINEAR_MIP_LINEAR,
  HOST_FILTER_LINEAR_MIP_NEAREST,
  HOST_FILTER_NEAREST,
  HOST_FILTER_NEAREST_MIP_LINEAR,
  HOST_FILTER_NEAREST_MIP_NEAREST,
  HOST_FORMAT_RED,
  HOST_FORMAT_RGB,
  HOST_FORMAT_RGBA,
  HOST_WRAP_CLAMP_TO_EDGE,
  HOST_WRAP_MIRRORED_REPEAT,
  HOST_WRAP_REPEAT,
} from '../../host/surfaceConstants.ts';
import { linearColour } from '../../host/graph/surfaceFields.ts';

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
const FORMAT: Record<string, number> = {
  rgba: HOST_FORMAT_RGBA,
  rgb: HOST_FORMAT_RGB,
  r: HOST_FORMAT_RED,
};
/** Material fields that hold a texture, by the name both sides give them. */
export const HOST_MAPS = [...TABLE_SLOTS, 'alphaMap', 'matcap', 'gradientMap'];
/** The maps that hold a colour: the only ones whose sRGB image is decoded. The others hold data —
 *  a direction, a roughness, an occlusion — read as stored whatever the image declares, as the
 *  WebGPU path reads them. */
const COLOUR_MAPS = new Set(['map', 'emissiveMap', 'matcap']);
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

/** Surface textures already built, by engine texture, its version and whether it is read as
 *  colour: a texture worn by several surfaces is uploaded once. */
export type HostTextures = Map<string, GraphTexture>;

/** The surface texture of a world texture, read as colour or as data, its sampler words
 *  translated; built once per `built` table. */
function hostTexture(texture: Texture, colour: boolean, built: HostTextures) {
  const key = `${texture.id}@${texture.version}:${colour}`;
  const held = built.get(key);
  if (held) return held;
  const host = new GraphTexture(texture.image);
  if (texture.layout === 'data') {
    // Raw texels: read as they are stored, one level, as the reference reads them.
    Object.assign(host, {
      isDataTexture: true,
      format: FORMAT[texture.format] ?? HOST_FORMAT_RGBA,
    });
    host.generateMipmaps = false;
  }
  host.wrapS = WRAP[texture.wrapS];
  host.wrapT = WRAP[texture.wrapT];
  host.repeat.set(texture.repeat.x, texture.repeat.y);
  host.offset.set(texture.offset.x, texture.offset.y);
  host.rotation = texture.rotation;
  host.minFilter = FILTER[texture.minFilter];
  host.magFilter = FILTER[texture.magFilter];
  host.colorSpace =
    texture.colorSpace === 'srgb' && colour ? HOST_COLOUR_SPACE_SRGB : HOST_COLOUR_SPACE_LINEAR;
  host.flipY = texture.flipY;
  host.anisotropy = texture.anisotropy;
  host.name = texture.name;
  host.needsUpdate = true;
  built.set(key, host);
  return host;
}

/** The family of each kind that is not physical. */
const FAMILY: Record<string, GraphSurfaceFamily> = {
  meshBasic: 'basic',
  line: 'basic',
  lineDashed: 'basic',
  points: 'basic',
  sprite: 'basic',
  shadow: 'basic',
  meshLambert: 'lambert',
  meshPhong: 'phong',
  meshToon: 'toon',
  meshNormal: 'normal',
  meshMatcap: 'matcap',
  meshDepth: 'depth',
};
/** Colours a family may carry, written in the linear working space both sides share. */
const COLOURS = ['color', 'emissive', 'specular'];

/** The physical surface: the engine's record, on a physical surface when it declares a physical
 *  field, which it then carries. */
function physicalSurface(material: Material, vertexColors: boolean) {
  const record = material.surface();
  const upgrade = PHYSICAL.some(
    (field) => typeof material[field] === 'number' && material[field] !== 0,
  );
  const surface = new GraphSurface(upgrade ? 'physical' : 'standard', {
    color: linearColour(record.baseColor),
    emissive: linearColour(record.emissive),
    metalness: record.metalness,
    roughness: record.roughness,
    opacity: record.opacity,
    transparent: record.alphaMode === 'blend',
    alphaTest: record.alphaMode === 'mask' ? record.alphaCutoff : 0,
    side: hostSide(record.side),
    vertexColors,
  });
  if (upgrade)
    for (const field of PHYSICAL)
      if (typeof material[field] === 'number') surface[field] = material[field];
  return surface;
}

/** A non-physical family, its fields written from the material's where the family has them. */
function familySurface(family: GraphSurfaceFamily, material: Material, vertexColors: boolean) {
  const surface = new GraphSurface(family);
  for (const field of COLOURS) {
    const colour = material[field] as { r: number; g: number; b: number } | undefined;
    const into = surface[field] as Color | undefined;
    if (colour && into?.isColor) into.setRGB(colour.r, colour.g, colour.b);
  }
  const emissive = surface.emissive as Color | undefined;
  if (emissive?.isColor) emissive.multiplyScalar(material.emissiveIntensity);
  if (typeof material.shininess === 'number' && 'shininess' in surface)
    surface.shininess = material.shininess;
  surface.opacity = material.opacity;
  surface.transparent = material.transparent;
  surface.alphaTest = material.alphaTest;
  surface.side = hostSide(material.side);
  surface.vertexColors = vertexColors;
  return surface;
}

/** The surface of a world material, with its maps and raster state. */
export function hostSurface(material: Material, vertexColors: boolean, textures: HostTextures) {
  const family = FAMILY[material.kind];
  const surface = family
    ? familySurface(family, material, vertexColors)
    : physicalSurface(material, vertexColors);
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
 * Writes a material's value fields — colour, glow, metalness, roughness — into the surface
 * built for it, as `hostSurface` wrote them, and bumps the surface's version: every reader of
 * the surface (`page/surface.ts`) takes them at its next read, no surface built again (#335).
 */
export function repaintHostSurface(surface: GraphSurface, material: Material) {
  const { color, emissive } = material;
  (surface.color as Color | undefined)?.setRGB(color.r, color.g, color.b);
  (surface.emissive as Color | undefined)
    ?.setRGB(emissive.r, emissive.g, emissive.b)
    .multiplyScalar(material.emissiveIntensity);
  if (typeof surface.metalness === 'number') surface.metalness = material.metalness;
  if (typeof surface.roughness === 'number') surface.roughness = material.roughness;
  surface.needsUpdate = true;
}
