/**
 * THE HOST TEXTURES OF A WORLD'S MATERIALS: each engine texture uploaded once through the host
 * library, and written again in place when a repaint moves it (#335, #360, #361). The texture
 * counts three things apart (`Texture.version`, `sampling`, `placement`): the picture is sent again
 * for a version only, the sampler and the placement are written as fields, read by the import at
 * the next image (`../../host/surfaceImport.ts`).
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
/** Host textures already built, by engine texture and whether it is read as colour: a texture
 *  worn by several surfaces is uploaded once. */
export type HostTextures = Map<string, THREE.Texture>;

const colourSpace = (texture: Texture, colour: boolean) =>
  texture.colorSpace === 'srgb' && colour ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;

/** The counters a host texture was last written at, in its `userData`. */
type Written = { version?: number; sampling?: number; placement?: number };

/** Writes into the host texture built for it what moved of a texture, by its counters: a new
 *  version sends the picture again (`needsUpdate`); sampling and placement are fields only. */
function writeHostTexture(host: THREE.Texture, texture: Texture, colour: boolean) {
  const written = host.userData as Written;
  if (written.placement !== texture.placement) {
    written.placement = texture.placement;
    host.repeat.set(texture.repeat.x, texture.repeat.y);
    host.offset.set(texture.offset.x, texture.offset.y);
    host.rotation = texture.rotation;
  }
  if (written.sampling !== texture.sampling) {
    written.sampling = texture.sampling;
    host.wrapS = WRAP[texture.wrapS];
    host.wrapT = WRAP[texture.wrapT];
    host.minFilter = FILTER[texture.minFilter] as THREE.MinificationTextureFilter;
    host.magFilter = FILTER[texture.magFilter] as THREE.MagnificationTextureFilter;
    host.anisotropy = texture.anisotropy;
  }
  if (written.version === texture.version) return;
  written.version = texture.version;
  host.image = texture.image as THREE.Texture['image'];
  host.flipY = texture.flipY;
  host.colorSpace = colourSpace(texture, colour);
  host.needsUpdate = true;
}

/** The host texture of an engine texture, read as colour or as data; built once per table and
 *  written in place afterwards. */
export function hostTexture(texture: Texture, colour: boolean, built: HostTextures) {
  const key = `${texture.id}:${colour}`;
  let host = built.get(key);
  if (!host) {
    const pixels = texture.image as { data: ArrayBufferView; width: number; height: number };
    const format = FORMAT[texture.format] ?? THREE.RGBAFormat;
    host =
      texture.layout === 'data'
        ? new THREE.DataTexture(pixels.data, pixels.width, pixels.height, format)
        : new THREE.Texture(texture.image as THREE.Texture['image']);
    host.name = texture.name;
    built.set(key, host);
  }
  writeHostTexture(host, texture, colour);
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
