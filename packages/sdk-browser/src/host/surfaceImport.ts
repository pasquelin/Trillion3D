/**
 * The one boundary that reads a host material and a host texture.
 *
 * What comes out is the engine's own records — `Texture` of `sdk-core/textureContract.ts` and the
 * `VisMaterial` of `../visibility/types.ts`, colours, factors, addressing and filtering in the engine's
 * words. Everything downstream — the page row, the tile pools, the transparent items, the software
 * raster — computes on those and never reaches back to the host object.
 *
 * Nothing here names a rendering library: a host material and a host texture are read through the
 * shapes of `shadedMaterial.ts`, and the state they declare through the named constants of
 * `surfaceConstants.ts`.
 *
 * A texture keeps ONE record for the session: atlas layers, preview ranks and lane pools address a
 * texture by the identity of its record, so a re-import refills the fields of the held record
 * instead of returning a second one.
 */

import type { HostColour, HostMaterials, HostTexture } from './resources.ts';
import { isHostColour, type HostShadedMaterial } from './shadedMaterial.ts';
import {
  HOST_FILTER_LINEAR_MIP_LINEAR,
  HOST_FILTER_LINEAR_MIP_NEAREST,
  HOST_FILTER_NEAREST,
  HOST_FILTER_NEAREST_MIP_LINEAR,
  HOST_FILTER_NEAREST_MIP_NEAREST,
  HOST_WRAP_CLAMP_TO_EDGE,
  HOST_WRAP_MIRRORED_REPEAT,
} from './surfaceConstants.ts';
import type { Texture, TextureFilter, WrapMode } from '../../../sdk-core/src/index.ts';
import { sideOf } from '../scene/materialSide.ts';
import type { VisMaterial } from '../visibility/types.ts';
import {
  SURFACE_MODEL,
  hostSurfaceModel,
  litModel,
  shininessRoughness,
} from '../scene/surfaceModel.ts';

/** Addressing the host declared, in the engine's words; anything else repeats, as the samplers do. */
export function importWrapMode(wrap: number): WrapMode {
  if (wrap === HOST_WRAP_CLAMP_TO_EDGE) return 'clamp';
  return wrap === HOST_WRAP_MIRRORED_REPEAT ? 'mirror' : 'repeat';
}

/** Filtering the host declared; an unknown constant reads linear, as the binders already did. */
function filterOf(filter: number): TextureFilter {
  if (filter === HOST_FILTER_NEAREST) return 'nearest';
  if (filter === HOST_FILTER_NEAREST_MIP_NEAREST) return 'nearest-mip-nearest';
  if (filter === HOST_FILTER_NEAREST_MIP_LINEAR) return 'nearest-mip-linear';
  if (filter === HOST_FILTER_LINEAR_MIP_NEAREST) return 'linear-mip-nearest';
  return filter === HOST_FILTER_LINEAR_MIP_LINEAR ? 'linear-mip-linear' : 'linear';
}

type Editable = { -readonly [K in keyof Texture]: Texture[K] };
const imported = new WeakMap<HostTexture, Editable>();

/** The engine record of a host texture, built once and refilled when the host bumps its version. */
export function importHostTexture(host: HostTexture): Texture {
  // The UV matrix is composed lazily by its owner, from repeat, offset and rotation, without a
  // version: a host animates them and sets `needsUpdate` on the material alone. It is recomposed
  // at every read, as the host's own renderer does at every draw, and the record ALIASES its
  // elements, so the placement written since is the one read.
  if (host.matrixAutoUpdate) host.updateMatrix();
  const held = imported.get(host);
  if (held && held.version === host.version && held.image === host.image) return held;
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

/** White is what a material with no declared colour is drawn with, as the host does. */
const WHITE: HostColour = { r: 1, g: 1, b: 1 };

/** Surface parameters of a host material, read in one place — here — into the engine's own
 *  record. Nothing is cached: every call re-reads the host declaration, so a reassigned material
 *  or a replaced map is seen as it stands. */
export function importHostSurface(material: HostMaterials): VisMaterial | undefined {
  const first = (Array.isArray(material) ? material[0] : material) as
    HostShadedMaterial | undefined;
  if (!first) return undefined;
  const color = isHostColour(first.color) ? first.color : WHITE;
  // A non-physical family reads in the one model (`../scene/surfaceModel.ts`): Lambert and toon lit
  // apart, Phong as the physical model at the roughness of its exponent, the others unlit.
  const model = hostSurfaceModel(first),
    lit = litModel(first, model),
    standard = !!first.isMeshStandardMaterial,
    physical = !!first.isMeshPhysicalMaterial,
    side = sideOf(first),
    emissive = lit && isHostColour(first.emissive) ? first.emissive : undefined,
    glow = emissive ? (first.emissiveIntensity ?? 1) : 0,
    normalScale = (lit && first.normalScale) || undefined;
  return {
    baseColor: [color.r, color.g, color.b],
    metalness: standard ? (first.metalness ?? 0) : 0,
    roughness: standard
      ? (first.roughness ?? 1)
      : first.isMeshPhongMaterial
        ? shininessRoughness(first.shininess ?? 30)
        : 1,
    lit,
    doubleSided: side === 'double',
    backSide: side === 'back',
    alphaTest: typeof first.alphaTest === 'number' ? first.alphaTest : 0,
    map: map(model === SURFACE_MODEL.matcap ? first.matcap : first.map),
    metalnessMap: lit ? map(first.metalnessMap) : undefined,
    roughnessMap: lit ? map(first.roughnessMap) : undefined,
    normalMap: lit ? map(first.normalMap) : undefined,
    normalScale: normalScale ? normalScale.x : 1,
    normalScaleY: normalScale ? normalScale.y : 1,
    aoMap: lit ? map(first.aoMap) : undefined,
    aoIntensity: lit ? (first.aoMapIntensity ?? 1) : 1,
    emissive: emissive ? [emissive.r * glow, emissive.g * glow, emissive.b * glow] : [0, 0, 0],
    emissiveMap: lit ? map(first.emissiveMap) : undefined,
    transmission: physical && typeof first.transmission === 'number' ? first.transmission : 0,
    ior: physical && typeof first.ior === 'number' ? first.ior : 1.5,
    thickness: physical && typeof first.thickness === 'number' ? first.thickness : 0,
    // A host yields `Infinity` when the glTF declares no attenuation distance; zero says “no
    // attenuation” without shipping an infinity as far as a uniform.
    attenuationDistance:
      physical && Number.isFinite(first.attenuationDistance) ? first.attenuationDistance! : 0,
    attenuationColor:
      physical && isHostColour(first.attenuationColor)
        ? [first.attenuationColor.r, first.attenuationColor.g, first.attenuationColor.b]
        : [1, 1, 1],
    model,
  };
}
