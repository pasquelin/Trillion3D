/**
 * The one boundary that reads a host material and a host texture.
 *
 * What comes out is the engine's own records — `Texture` of `../../../sdk-core/src/texture/contract.ts` and the
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

import type { HostColour, HostMaterials, HostTexture } from './resources.ts'
import { isHostColour, type HostShadedMaterial } from './shadedMaterial.ts'
import { importHostTexture } from './textureImport.ts'
import type { Side, Texture } from '../../../sdk-core/src/index.ts'
import { sideOf } from '../scene/materialSide.ts'
import type { VisMaterial } from '../visibility/types.ts'
import {
  SURFACE_MODEL,
  hostSurfaceModel,
  litModel,
  shininessRoughness,
  metalRough,
} from '../scene/surfaceModel.ts'

const map = (texture: unknown) => (texture ? importHostTexture(texture as HostTexture) : undefined)

/** A host-keyed table of glTF texture ranks, rekeyed once on the records the engine addresses. */
export function importTextureIndices(indices?: ReadonlyMap<HostTexture, number>) {
  if (!indices) return undefined
  const ranks = new Map<Texture, number>()
  for (const [host, rank] of indices) ranks.set(importHostTexture(host), rank)
  return ranks
}

/** White is what a material with no declared colour is drawn with, as the host does. */
const WHITE: HostColour = { r: 1, g: 1, b: 1 }

/** Surface parameters of a host material, read in one place — here — into the engine's own
 *  record. Nothing is cached: every call re-reads the host declaration, so a reassigned material
 *  or a replaced map is seen as it stands. */
export function importHostSurface(material: HostMaterials): VisMaterial | undefined {
  const first = (Array.isArray(material) ? material[0] : material) as HostShadedMaterial | undefined
  if (!first) return undefined
  // A non-physical family reads in the one model (`../scene/surfaceModel.ts`): Lambert and toon lit
  // apart, Phong as the physical model at the roughness of its exponent, the others unlit.
  return surfaceRecord(first, hostSurfaceModel(first), litModel(first), sideOf(first))
}

/** The record of `first`, of surface model `model`, lit or not, drawn on `side`. Every value is
 *  read by a helper of its own, so the record is built in one literal, its fields in one order.
 *
 *  A page stores no tangent: every engine pass rebuilds the frame a page is shaded in from its
 *  triangle, which turns the second factor of a surface written for vertex tangents — the sign
 *  the material table gives that surface's other variant (`docs/FORMAT.md`). A pass reading a
 *  host geometry's own tangents takes the factor the surface was written with (`written`). */
function surfaceRecord(
  first: HostShadedMaterial,
  model: number,
  lit: boolean,
  side: Side,
): VisMaterial {
  const color = isHostColour(first.color) ? first.color : WHITE
  const standard = metalRough(first),
    physical = first.family === 'physical',
    sheet = lit && side === 'double',
    emissive = lit && isHostColour(first.emissive) ? first.emissive : undefined,
    glow = emissive ? (first.emissiveIntensity ?? 1) : 0,
    normalScale = (lit && first.normalScale) || undefined,
    scaleY = normalScale ? normalScale.y : 1,
    written = first.forVertexTangents
  return {
    baseColor: [color.r, color.g, color.b],
    metalness: valueIf(standard, first.metalness, 0),
    roughness: roughnessOf(first, standard),
    lit,
    fog: first.fog !== false,
    doubleSided: side === 'double',
    backSide: side === 'back',
    alphaTest: numberOr(first.alphaTest, 0),
    map: map(model === SURFACE_MODEL.matcap ? first.matcap : first.map),
    metalnessMap: mapIf(lit, first.metalnessMap),
    roughnessMap: mapIf(lit, first.roughnessMap),
    normalMap: mapIf(lit, first.normalMap),
    normalScale: normalScale ? normalScale.x : 1,
    normalScaleY: written ? -scaleY : scaleY,
    tangentNormalScaleY: written === false ? -scaleY : scaleY,
    aoMap: mapIf(lit, first.aoMap),
    aoIntensity: valueIf(lit, first.aoMapIntensity, 1, 1),
    emissive: emissiveOf(emissive, glow),
    emissiveMap: mapIf(lit, first.emissiveMap),
    subsurfaceColor: colourIf(sheet, first.subsurfaceColor, 0),
    subsurfaceMap: mapIf(sheet, first.subsurfaceMap),
    anisotropy: valueIf(physical, first.anisotropy, 0),
    anisotropyRotation: valueIf(physical, first.anisotropyRotation, 0),
    clearcoat: valueIf(physical, first.clearcoat, 0),
    anisotropyMap: mapIf(physical, first.anisotropyMap),
    clearcoatMap: mapIf(physical, first.clearcoatMap),
    clearcoatRoughnessMap: mapIf(physical, first.clearcoatRoughnessMap),
    clearcoatNormalMap: mapIf(physical, first.clearcoatNormalMap),
    clearcoatNormalScale: clearcoatScale(first, written),
    clearcoatRoughness: valueIf(physical, first.clearcoatRoughness, 0),
    transmission: physical ? numberOr(first.transmission, 0) : 0,
    ior: physical ? numberOr(first.ior, 1.5) : 1.5,
    thickness: physical ? numberOr(first.thickness, 0) : 0,
    attenuationDistance: attenuationDistanceOf(first, physical),
    attenuationColor: colourIf(physical, first.attenuationColor, 1),
    vertexColors: first.vertexColors === true,
    model,
    lineWidth: numberOr(first.lineWidth, 0),
    ...dashOf(first),
    ...spriteOf(first),
  }
}

type Rgb = [number, number, number]

/** `texture`'s record when `on`. */
const mapIf = (on: boolean, texture: unknown) => (on ? map(texture) : undefined)

/** `value`, or `fallback` when unsaid, when `on`; `off` otherwise. */
const valueIf = (on: boolean, value: number | undefined, fallback: number, off = 0) =>
  on ? (value ?? fallback) : off

/** `value` when it is a number, else `fallback`. */
const numberOr = (value: unknown, fallback: number) =>
  typeof value === 'number' ? value : fallback

/** `colour`'s three channels when `on` and it is one, else `fallback` on each. */
const colourIf = (on: boolean, colour: unknown, fallback: number): Rgb =>
  on && isHostColour(colour) ? [colour.r, colour.g, colour.b] : [fallback, fallback, fallback]

/** A metal-rough surface's roughness, a Phong surface's from its exponent, else 1. */
const roughnessOf = (first: HostShadedMaterial, standard: boolean) =>
  standard
    ? (first.roughness ?? 1)
    : first.family === 'phong'
      ? shininessRoughness(first.shininess ?? 30)
      : 1

const emissiveOf = (emissive: HostColour | undefined, glow: number): Rgb =>
  emissive ? [emissive.r * glow, emissive.g * glow, emissive.b * glow] : [0, 0, 0]

const clearcoatScale = (
  first: HostShadedMaterial,
  written: boolean | undefined,
): [number, number] => [
  first.clearcoatNormalScale?.x ?? 1,
  (written ? -1 : 1) * (first.clearcoatNormalScale?.y ?? 1),
]

/** A host yields `Infinity` when the glTF declares no attenuation distance; zero says “no
 *  attenuation” without shipping an infinity as far as a uniform. */
const attenuationDistanceOf = (first: HostShadedMaterial, physical: boolean) =>
  physical && Number.isFinite(first.attenuationDistance) ? first.attenuationDistance! : 0

const dashOf = (first: HostShadedMaterial) =>
  typeof first.dashSize === 'number'
    ? { dashSize: first.dashSize, gapSize: first.gapSize ?? 0 }
    : {}

const spriteOf = (first: HostShadedMaterial) =>
  first.sprite === true
    ? {
        sprite: {
          rotation: first.rotation ?? 0,
          sizeAttenuation: first.sizeAttenuation !== false,
        },
      }
    : {}
