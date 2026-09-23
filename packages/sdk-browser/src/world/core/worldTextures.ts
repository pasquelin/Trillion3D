/**
 * THE HOST TEXTURES OF A WORLD'S MATERIALS: each engine texture uploaded once through the host
 * library, its addressing, filters and placement written in the host's words, and written again
 * in place when a repaint moves them (#335, #360, #361) — as long as the picture itself did not
 * change, which only a new upload shows.
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

/** What a host texture was uploaded from beyond its sampling: a change there needs a new upload,
 *  which a repaint does not make. */
const pictureOf = (texture: Texture) =>
  [texture.image, texture.flipY, texture.colorSpace, texture.channel] as const;

/** True when a host texture still shows the picture it was built from (`pictureOf`). */
const samePicture = (host: THREE.Texture, texture: Texture) => {
  const held = host.userData.picture as ReturnType<typeof pictureOf>;
  return pictureOf(texture).every((value, i) => value === held[i]);
};

/**
 * Writes how a host texture samples, and only what moved. The placement of the picture —
 * repeat, offset, rotation — is its UV matrix, recomposed in place and read at every draw: no
 * upload. Addressing and filters are the host texture's upload state: only a change there bumps
 * its version, which uploads it again on WebGL2 and refills its engine record
 * (`../../host/surfaceImport.ts`). A repaint of a colour alone changes nothing here.
 */
function writeHostSampling(host: THREE.Texture, texture: Texture) {
  const { repeat, offset } = texture;
  if (
    host.repeat.x !== repeat.x ||
    host.repeat.y !== repeat.y ||
    host.offset.x !== offset.x ||
    host.offset.y !== offset.y ||
    host.rotation !== texture.rotation
  ) {
    host.repeat.set(repeat.x, repeat.y);
    host.offset.set(offset.x, offset.y);
    host.rotation = texture.rotation;
    host.updateMatrix();
  }
  const wrapS = WRAP[texture.wrapS],
    wrapT = WRAP[texture.wrapT],
    minFilter = FILTER[texture.minFilter] as THREE.MinificationTextureFilter,
    magFilter = FILTER[texture.magFilter] as THREE.MagnificationTextureFilter;
  if (
    host.wrapS === wrapS &&
    host.wrapT === wrapT &&
    host.minFilter === minFilter &&
    host.magFilter === magFilter &&
    host.anisotropy === texture.anisotropy
  )
    return;
  host.wrapS = wrapS;
  host.wrapT = wrapT;
  host.minFilter = minFilter;
  host.magFilter = magFilter;
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
  host.userData.picture = pictureOf(texture);
  host.needsUpdate = true;
  built.set(key, host);
  return host;
}

/**
 * Writes the sampling of a material's maps into the host textures a surface holds — `false`, and
 * nothing written, when one of them shows another picture than the one it was uploaded from.
 */
export function repaintHostMaps(into: Record<string, unknown>, material: Material) {
  const maps: [THREE.Texture, Texture][] = [];
  for (const field of HOST_MAPS) {
    const texture = material[field] as Texture | undefined,
      host = into[field] as THREE.Texture | null | undefined;
    if (!texture?.isTexture || !host?.isTexture) continue;
    if (!samePicture(host, texture)) return false;
    maps.push([host, texture]);
  }
  for (const [host, texture] of maps) writeHostSampling(host, texture);
  return true;
}
