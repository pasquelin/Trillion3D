/**
 * The one boundary that reads a host material and a host texture, and the only file of the engine
 * path that still names the host rendering library for a surface.
 *
 * What comes out is the engine's own records — `Texture` of `sdk-core/textureContract.ts` and the
 * `VisMaterial` of `visibilityTypes.ts`, colours, factors, addressing and filtering in the engine's
 * words. Everything downstream — the page row, the tile pools, the transparent items, the software
 * raster — computes on those and never reaches back to the host object.
 *
 * A texture keeps ONE record for the session: atlas layers, preview ranks and lane pools address a
 * texture by the identity of its record, so a re-import refills the fields of the held record
 * instead of returning a second one.
 */

import * as THREE from 'three';
import type { HostMaterials, HostTexture } from './hostResources.ts';
import type { Texture, TextureFilter, WrapMode } from '../sdk-core/index.ts';
import { sideOf } from './materialSide.ts';
import type { VisMaterial } from './visibilityTypes.ts';

/** Addressing the host declared, in the engine's words; anything else repeats, as the samplers do. */
export function importWrapMode(wrap: number): WrapMode {
  if (wrap === THREE.ClampToEdgeWrapping) return 'clamp';
  return wrap === THREE.MirroredRepeatWrapping ? 'mirror' : 'repeat';
}

/** Filtering the host declared; an unknown constant reads linear, as the binders already did. */
function filterOf(filter: number): TextureFilter {
  if (filter === THREE.NearestFilter) return 'nearest';
  if (filter === THREE.NearestMipmapNearestFilter) return 'nearest-mip-nearest';
  if (filter === THREE.NearestMipmapLinearFilter) return 'nearest-mip-linear';
  if (filter === THREE.LinearMipmapNearestFilter) return 'linear-mip-nearest';
  return filter === THREE.LinearMipmapLinearFilter ? 'linear-mip-linear' : 'linear';
}

type Editable = { -readonly [K in keyof Texture]: Texture[K] };
const imported = new WeakMap<HostTexture, Editable>();

/** The engine record of a host texture, built once and refilled when the host bumps its version. */
export function importHostTexture(host: HostTexture): Texture {
  const held = imported.get(host);
  if (held && held.version === host.version && held.image === host.image) return held;
  // `KHR_texture_transform` is composed lazily by its owner: the import asks for it once, then
  // ALIASES the composed elements, so a recomposition the host makes later is read as it stands.
  if (host.matrixAutoUpdate) host.updateMatrix();
  const record = held ?? ({} as Editable);
  record.id = host.uuid;
  record.name = host.name;
  record.image = host.image;
  record.channel = host.channel;
  record.wrapS = importWrapMode(host.wrapS);
  record.wrapT = importWrapMode(host.wrapT);
  record.magFilter = filterOf(host.magFilter);
  record.minFilter = filterOf(host.minFilter);
  record.anisotropy = host.anisotropy;
  record.flipY = host.flipY;
  record.premultiplyAlpha = host.premultiplyAlpha;
  record.generateMipmaps = host.generateMipmaps;
  record.colorSpace = host.colorSpace === 'srgb' ? 'srgb' : 'linear';
  record.transform = host.matrix.elements;
  record.version = host.version;
  if (!held) imported.set(host, record);
  return record;
}

const map = (texture: unknown) => (texture ? importHostTexture(texture as HostTexture) : undefined);

/** A host-keyed table of glTF texture ranks, rekeyed once on the records the engine addresses. */
export function importTextureIndices(indices?: ReadonlyMap<HostTexture, number>) {
  if (!indices) return undefined;
  const ranks = new Map<Texture, number>();
  for (const [host, rank] of indices) ranks.set(importHostTexture(host), rank);
  return ranks;
}

/** Surface parameters of a host material, read in one place — here — into the engine's own
 *  record. Nothing is cached: every call re-reads the host declaration, so a reassigned material
 *  or a replaced map is seen as it stands. */
export function importHostSurface(material: HostMaterials): VisMaterial | undefined {
  const first = Array.isArray(material) ? material[0] : material;
  if (!first) return undefined;
  const color =
    'color' in first && first.color instanceof THREE.Color ? first.color : new THREE.Color(1, 1, 1);
  const std = first as THREE.MeshStandardMaterial;
  const phys = first as THREE.MeshPhysicalMaterial;
  const lit = !!std.isMeshStandardMaterial,
    side = sideOf(first);
  return {
    baseColor: [color.r, color.g, color.b],
    metalness: lit ? std.metalness : 0,
    roughness: lit ? std.roughness : 1,
    lit,
    doubleSided: side === 'double',
    backSide: side === 'back',
    alphaTest: 'alphaTest' in first && typeof first.alphaTest === 'number' ? first.alphaTest : 0,
    map: 'map' in first ? map(first.map) : undefined,
    metalnessMap: lit ? map(std.metalnessMap) : undefined,
    roughnessMap: lit ? map(std.roughnessMap) : undefined,
    normalMap: lit ? map(std.normalMap) : undefined,
    normalScale: lit && std.normalScale ? std.normalScale.x : 1,
    normalScaleY: lit && std.normalScale ? std.normalScale.y : 1,
    aoMap: lit ? map(std.aoMap) : undefined,
    aoIntensity: lit ? std.aoMapIntensity : 1,
    emissive: lit
      ? [
          std.emissive.r * std.emissiveIntensity,
          std.emissive.g * std.emissiveIntensity,
          std.emissive.b * std.emissiveIntensity,
        ]
      : [0, 0, 0],
    emissiveMap: lit ? map(std.emissiveMap) : undefined,
    transmission:
      phys.isMeshPhysicalMaterial && typeof phys.transmission === 'number' ? phys.transmission : 0,
    ior: phys.isMeshPhysicalMaterial && typeof phys.ior === 'number' ? phys.ior : 1.5,
    thickness:
      phys.isMeshPhysicalMaterial && typeof phys.thickness === 'number' ? phys.thickness : 0,
    // Three yields `Infinity` when the glTF does not declare a distance; zero says “no attenuation”
    // without shipping an infinity as far as a uniform.
    attenuationDistance:
      phys.isMeshPhysicalMaterial && Number.isFinite(phys.attenuationDistance)
        ? phys.attenuationDistance
        : 0,
    attenuationColor:
      phys.isMeshPhysicalMaterial && phys.attenuationColor
        ? [phys.attenuationColor.r, phys.attenuationColor.g, phys.attenuationColor.b]
        : [1, 1, 1],
  };
}
