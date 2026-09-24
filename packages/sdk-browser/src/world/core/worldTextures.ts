/**
 * THE HOST TEXTURES OF A WORLD'S MATERIALS: each engine texture uploaded once through the host
 * library, its addressing, filters and placement written in the host's words, and written again
 * in place when a repaint moves them (#335, #360, #361). A picture that changed — which only a
 * new upload shows — is left as it was uploaded: textures that change their pixels live are
 * #362's.
 */
import * as THREE from 'three';
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import { TABLE_SLOTS } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import { pictureWords, textureChange } from '../../../../sdk-core/src/texture/contract.ts';
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

/**
 * True when the picture a host texture shows is no longer the texture's (`textureChange`, the rule
 * the WebGL2 binder reads too): another image, flip, colour space or UV set — or a version that
 * moved with neither its sampling nor its placement, the pixels written in place then
 * `needsUpdate`. Only a new upload would show it.
 */
const pictureMoved = (host: THREE.Texture, texture: Texture) =>
  textureChange(
    host.userData as { version: number; picture: unknown[] },
    texture,
    !placementHeld(host, texture) || !addressingHeld(host, texture),
  ) === 'picture';

/**
 * Writes how a host texture samples, and only what moved. The placement of the picture is its UV
 * matrix, which the import recomposes at its next read (`importHostTexture`). Addressing and filters are the host
 * texture's sampler state: a change there bumps its version, which refills its engine record
 * (`../../host/surfaceImport.ts`); the pixels stay, the WebGL2 binder sets the sampler on the
 * texture it holds (`../../webgl/cluster/textures.ts`). A repaint of a colour alone changes
 * nothing here.
 */
function writeHostSampling(host: THREE.Texture, texture: Texture) {
  host.userData.version = texture.version;
  if (!placementHeld(host, texture)) {
    host.repeat.set(texture.repeat.x, texture.repeat.y);
    host.offset.set(texture.offset.x, texture.offset.y);
    host.rotation = texture.rotation;
  }
  if (addressingHeld(host, texture)) return;
  host.wrapS = WRAP[texture.wrapS];
  host.wrapT = WRAP[texture.wrapT];
  host.minFilter = FILTER[texture.minFilter] as THREE.MinificationTextureFilter;
  host.magFilter = FILTER[texture.magFilter] as THREE.MagnificationTextureFilter;
  host.anisotropy = texture.anisotropy;
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
  writeHostSampling(host, texture);
  host.colorSpace =
    texture.colorSpace === 'srgb' && colour ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  host.flipY = texture.flipY;
  host.name = texture.name;
  host.userData.picture = pictureWords(texture);
  host.needsUpdate = true;
  built.set(key, host);
  return host;
}

/**
 * Writes the sampling of a material's maps into the host textures a surface holds. A map whose
 * picture moved (`pictureMoved`) is left as uploaded, sampling included, as before #360: a
 * repaint never uploads, nor reopens the session — a video or a canvas reassigned at every frame
 * would reopen it at every frame. Live pictures are #362's.
 */
export function repaintHostMaps(into: Record<string, unknown>, material: Material) {
  for (const field of HOST_MAPS) {
    const texture = material[field] as Texture | undefined,
      host = into[field] as THREE.Texture | null | undefined;
    if (texture?.isTexture && host?.isTexture && !pictureMoved(host, texture))
      writeHostSampling(host, texture);
  }
}
