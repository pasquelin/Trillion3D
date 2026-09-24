/**
 * THE HOST TEXTURES OF A WORLD'S MATERIALS: each engine texture uploaded once through the host
 * library, its addressing, filters and placement written in the host's words, and written again
 * in place when a repaint moves them (#335, #360, #361). Every version a texture moves to sends
 * its picture again — nothing tells pixels written in place under the same image from a sampler
 * change —, except a move of its placement alone, which the host reads at every draw.
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

/** True when a host texture's placement — repeat, offset, rotation — is the texture's. */
const placementHeld = (host: THREE.Texture, texture: Texture) =>
  host.repeat.x === texture.repeat.x &&
  host.repeat.y === texture.repeat.y &&
  host.offset.x === texture.offset.x &&
  host.offset.y === texture.offset.y &&
  host.rotation === texture.rotation;

/** True when a host texture's addressing, filters and anisotropy are the texture's. */
const addressingHeld = (host: THREE.Texture, texture: Texture) =>
  host.wrapS === WRAP[texture.wrapS] &&
  host.wrapT === WRAP[texture.wrapT] &&
  host.minFilter === FILTER[texture.minFilter] &&
  host.magFilter === FILTER[texture.magFilter] &&
  host.anisotropy === texture.anisotropy;

/** True when a host texture shows the texture's picture: its image, flip and colour space. */
const pictureHeld = (host: THREE.Texture, texture: Texture, colour: boolean) =>
  host.image === texture.image &&
  host.flipY === texture.flipY &&
  host.colorSpace === colourSpace(texture, colour);

const colourSpace = (texture: Texture, colour: boolean) =>
  texture.colorSpace === 'srgb' && colour ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;

/**
 * Writes a texture's version into the host texture built for it — all of it on a texture just
 * built. Its placement is the UV matrix the import recomposes at its next read
 * (`../../host/surfaceImport.ts`): moved alone, it uploads nothing. Any other move sends the
 * picture again with its sampler state, as the host does on `needsUpdate`.
 */
function writeHostTexture(host: THREE.Texture, texture: Texture, colour: boolean) {
  const placementOnly =
    host.userData.version !== undefined &&
    !placementHeld(host, texture) &&
    addressingHeld(host, texture) &&
    pictureHeld(host, texture, colour);
  host.userData.version = texture.version;
  host.repeat.set(texture.repeat.x, texture.repeat.y);
  host.offset.set(texture.offset.x, texture.offset.y);
  host.rotation = texture.rotation;
  if (placementOnly) return;
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
  if (held) return held;
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

/** Writes the version of each map of a material into the host texture a surface holds. */
export function repaintHostMaps(into: Record<string, unknown>, material: Material) {
  for (const field of HOST_MAPS) {
    const texture = material[field] as Texture | undefined,
      host = into[field] as THREE.Texture | null | undefined;
    if (texture?.isTexture && host?.isTexture && host.userData.version !== texture.version)
      writeHostTexture(host, texture, COLOUR_MAPS.has(field));
  }
}
