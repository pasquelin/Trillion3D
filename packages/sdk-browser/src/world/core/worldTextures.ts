/**
 * THE HOST TEXTURES OF A WORLD'S MATERIALS: each engine texture uploaded once through the host
 * library, its addressing, filters and placement written in the host's words, and written again
 * in place when a repaint moves them (#335, #360, #361). A texture counts its placement apart
 * from its version: every version sends its picture again — nothing tells pixels written in place
 * under the same image from a sampler change —, a placement never.
 */
import * as THREE from 'three';
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
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
export const COLOUR_MAPS = new Set(['map', 'emissiveMap', 'matcap']);
/** Host textures already built, by engine texture, its version and whether it is read as colour:
 *  a texture worn by several surfaces is uploaded once. */
export type HostTextures = Map<string, THREE.Texture>;

const colourSpace = (texture: Texture, colour: boolean) =>
  texture.colorSpace === 'srgb' && colour ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;

/**
 * Writes a texture into the host texture built for it: its placement when its placement counter
 * moved — the UV matrix the import recomposes once per image (`../../host/surfaceImport.ts`),
 * nothing uploaded —, and everything else when its version moved, the picture sent again with its
 * sampler state, as the host does on `needsUpdate`. A texture just built takes both.
 */
function writeHostTexture(host: THREE.Texture, texture: Texture, colour: boolean) {
  if (host.userData.placement !== texture.placement) {
    host.userData.placement = texture.placement;
    host.repeat.set(texture.repeat.x, texture.repeat.y);
    host.offset.set(texture.offset.x, texture.offset.y);
    host.rotation = texture.rotation;
  }
  if (host.userData.version === texture.version) return;
  host.userData.version = texture.version;
  host.wrapS = WRAP[texture.wrapS];
  host.wrapT = WRAP[texture.wrapT];
  host.minFilter = FILTER[texture.minFilter] as THREE.MinificationTextureFilter;
  host.magFilter = FILTER[texture.magFilter] as THREE.MagnificationTextureFilter;
  host.anisotropy = texture.anisotropy;
  host.image = texture.image as THREE.Texture['image'];
  host.flipY = texture.flipY;
  host.colorSpace = colourSpace(texture, colour);
  host.needsUpdate = true;
}

/** The host texture of an engine texture, read as colour or as data; built once per table. */
export function hostTexture(texture: Texture, colour: boolean, built: HostTextures) {
  const key = `${texture.id}@${texture.version}:${colour}`;
  const held = built.get(key);
  if (held) {
    writeHostTexture(held, texture, colour);
    return held;
  }
  const pixels = texture.image as { data: ArrayBufferView; width: number; height: number };
  const format = FORMAT[texture.format] ?? THREE.RGBAFormat;
  const host =
    texture.layout === 'data'
      ? new THREE.DataTexture(pixels.data, pixels.width, pixels.height, format)
      : new THREE.Texture(texture.image as THREE.Texture['image']);
  host.name = texture.name;
  writeHostTexture(host, texture, colour);
  built.set(key, host);
  return host;
}

/** Writes what moved of each map of a material into the host texture a surface holds. */
export function repaintHostMaps(into: Record<string, unknown>, material: Material) {
  for (const field of HOST_MAPS) {
    const texture = material[field] as Texture | undefined,
      host = into[field] as THREE.Texture | null | undefined;
    if (texture?.isTexture && host?.isTexture)
      writeHostTexture(host, texture, COLOUR_MAPS.has(field));
  }
}
