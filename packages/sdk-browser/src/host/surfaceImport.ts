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
 * A texture keeps ONE record for the session (`textureImport.ts`).
 */

import type { HostColour, HostMaterials, HostTexture } from './resources.ts';
import { isHostColour, type HostShadedMaterial } from './shadedMaterial.ts';
import { importHostTexture } from './textureImport.ts';
import type { Texture } from '../../../sdk-core/src/index.ts';
import { sideOf } from '../scene/materialSide.ts';
import type { VisMaterial } from '../visibility/types.ts';
import {
  SURFACE_MODEL,
  hostSurfaceModel,
  litModel,
  shininessRoughness,
  metalRough,
} from '../scene/surfaceModel.ts';

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
    standard = metalRough(first),
    physical = first.family === 'physical',
    side = sideOf(first),
    emissive = lit && isHostColour(first.emissive) ? first.emissive : undefined,
    glow = emissive ? (first.emissiveIntensity ?? 1) : 0,
    normalScale = (lit && first.normalScale) || undefined;
  return {
    baseColor: [color.r, color.g, color.b],
    metalness: standard ? (first.metalness ?? 0) : 0,
    roughness: standard
      ? (first.roughness ?? 1)
      : first.family === 'phong'
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
    vertexColors: first.vertexColors === true,
    model,
    lineWidth: typeof first.lineWidth === 'number' ? first.lineWidth : 0,
    ...(typeof first.dashSize === 'number'
      ? { dashSize: first.dashSize, gapSize: first.gapSize ?? 0 }
      : {}),
    ...(first.sprite === true
      ? {
          sprite: {
            rotation: first.rotation ?? 0,
            sizeAttenuation: first.sizeAttenuation !== false,
          },
        }
      : {}),
  };
}
