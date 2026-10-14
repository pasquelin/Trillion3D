/**
 * THE ONE SURFACE RECORD OF A MATERIAL, written by its owner from what it declares.
 *
 * A world material (`../world/core/worldSurface.ts`), a table material
 * (`../host/prepared/materials.ts`) and a material a page creates (`../host/pageObjects.ts`) each
 * declare their surface once, in the engine's words, and get back the record every mesh wearing
 * them holds and every reader reads in place — the page rows, the tile pools, the transparent
 * items, the proxy surfaces. The declaration is an argument, never kept: there is no second object
 * per material to copy from or to follow. A rewrite fills the same record again and journals it
 * (`surfaceWrites.ts`), so a holder sees the new fields with no lookup and a consumer visits only
 * the records written.
 *
 * What each family reads of a declaration is decided here once: Lambert and toon lit apart, Phong
 * as the physical model at the roughness of its exponent, the others unlit
 * (`../scene/surfaceModel.ts`); a field a family does not read is left at its silent value.
 */
import { Color } from '../../../sdk-core/src/world/math/color.ts'
import { DEFAULT_IOR, DEFAULT_SHININESS } from '../../../sdk-core/src/world/material/index.ts'
import { Releasable } from '../host/graph/resource.ts'
import {
  SURFACE_MODEL,
  familyModel,
  litFamily,
  metalRoughFamily,
  shininessRoughness,
  unreadMapRefusal,
} from '../scene/surfaceModel.ts'
import type { PageSurface, SurfaceFamily } from './surface.ts'
import type { Slot, SurfaceDeclaration } from './surfaceDeclaration.ts'
import type { HostColour } from '../host/resources.ts'
import { surfaceWritten } from './surfaceWrites.ts'

type Rgb = [number, number, number]

const WHITE: HostColour = { r: 1, g: 1, b: 1 }
/** A Phong surface's highlight colour when it declares none. */
const PHONG_SPECULAR = new Color(0x111111)
/** The families that carry a base colour: a normal or depth surface shows something else. */
const UNCOLOURED = new Set<SurfaceFamily>(['normal', 'depth'])

const rgb = (colour: HostColour): Rgb => [colour.r, colour.g, colour.b]
const mapIf = (on: boolean, texture: Slot) => (on ? (texture ?? undefined) : undefined)
const valueIf = (on: boolean, value: number | undefined, fallback: number, off = 0) =>
  on ? (value ?? fallback) : off
const colourIf = (on: boolean, colour: HostColour | undefined, fallback: number): Rgb =>
  on && colour ? rgb(colour) : [fallback, fallback, fallback]

/** What a surface of `family` reads, decided once per declaration. */
function reading(d: SurfaceDeclaration) {
  const { family } = d,
    lit = litFamily(family),
    side = d.side ?? 'front'
  return {
    model: familyModel(family),
    lit,
    side,
    standard: metalRoughFamily(family),
    physical: family === 'physical',
    sheet: lit && side === 'double',
  }
}
type Reading = ReturnType<typeof reading>

/** Its colours, its glow scaled by its intensity, its metal and roughness — a Phong surface's
 *  read off its exponent —, its side and alpha. */
function factors(d: SurfaceDeclaration, { lit, side, standard, sheet }: Reading) {
  const emissive = lit ? d.emissive : undefined,
    glow = emissive ? (d.emissiveIntensity ?? 1) : 0
  return {
    baseColor: rgb(UNCOLOURED.has(d.family) ? WHITE : (d.color ?? WHITE)),
    metalness: valueIf(standard, d.metalness, 0),
    roughness: standard
      ? (d.roughness ?? 1)
      : d.family === 'phong'
        ? shininessRoughness(d.shininess ?? DEFAULT_SHININESS)
        : 1,
    lit,
    fog: d.fog !== false,
    side,
    alphaTest: d.alphaTest ?? 0,
    emissive: emissive ? (rgb(emissive).map((c) => c * glow) as Rgb) : ([0, 0, 0] as Rgb),
    subsurfaceColor: colourIf(sheet, d.subsurfaceColor, 0),
    vertexColors: d.vertexColors === true,
  }
}

/** Its map slots, each read only by a model that samples it. */
function slots(d: SurfaceDeclaration, { model, lit, standard, physical, sheet }: Reading) {
  return {
    map:
      model === SURFACE_MODEL.matcap ? mapIf(true, d.matcap) : mapIf(d.family !== 'normal', d.map),
    metalnessMap: mapIf(standard, d.metalnessMap),
    roughnessMap: mapIf(standard, d.roughnessMap),
    normalMap: mapIf(lit, d.normalMap),
    aoMap: mapIf(lit, d.aoMap),
    emissiveMap: mapIf(lit, d.emissiveMap),
    subsurfaceMap: mapIf(sheet, d.subsurfaceMap),
    anisotropyMap: mapIf(physical, d.anisotropyMap),
    clearcoatMap: mapIf(physical, d.clearcoatMap),
    clearcoatRoughnessMap: mapIf(physical, d.clearcoatRoughnessMap),
    clearcoatNormalMap: mapIf(physical, d.clearcoatNormalMap),
  }
}

/** Its normal factors. A page stores no tangent: every engine pass rebuilds the frame from its
 *  triangle, which turns the second factor of a surface written for vertex tangents
 *  (`forVertexTangents`); a pass reading vertex tangents takes the factor as written. */
function relief(d: SurfaceDeclaration, { lit }: Reading) {
  const scale = (lit && d.normalScale) || undefined,
    y = scale ? scale.y : 1,
    written = d.forVertexTangents,
    coat = d.clearcoatNormalScale
  return {
    normalScale: scale ? scale.x : 1,
    normalScaleY: written ? -y : y,
    tangentNormalScaleY: written === false ? -y : y,
    aoIntensity: valueIf(lit, d.aoMapIntensity, 1, 1),
    clearcoatNormalScale: [coat?.x ?? 1, (written ? -1 : 1) * (coat?.y ?? 1)] as [number, number],
  }
}

/** Its physical lobes and volume: silent on any other family. Zero says "no attenuation" without
 *  shipping an infinity as far as a uniform. */
function lobes(d: SurfaceDeclaration, { physical }: Reading) {
  return {
    anisotropy: valueIf(physical, d.anisotropy, 0),
    anisotropyRotation: valueIf(physical, d.anisotropyRotation, 0),
    clearcoat: valueIf(physical, d.clearcoat, 0),
    clearcoatRoughness: valueIf(physical, d.clearcoatRoughness, 0),
    transmission: valueIf(physical, d.transmission, 0),
    ior: valueIf(physical, d.ior, DEFAULT_IOR, DEFAULT_IOR),
    thickness: valueIf(physical, d.thickness, 0),
    attenuationDistance:
      physical && Number.isFinite(d.attenuationDistance) ? d.attenuationDistance! : 0,
    attenuationColor: colourIf(physical, d.attenuationColor, 1),
  }
}

/** What a line or a sprite draws: its width, a dashed line's dash and gap, a sprite's turn. */
const shape = (d: SurfaceDeclaration) => ({
  lineWidth: d.lineWidth ?? 0,
  ...(typeof d.dashSize === 'number' ? { dashSize: d.dashSize, gapSize: d.gapSize ?? 0 } : {}),
  ...(d.sprite === true
    ? { sprite: { rotation: d.rotation ?? 0, sizeAttenuation: d.sizeAttenuation !== false } }
    : {}),
})

/** The raster facts of `d`, and what a Phong surface's highlight is drawn with. */
const raster = (d: SurfaceDeclaration) => ({
  name: d.name ?? '',
  family: d.family,
  opacity: d.opacity ?? 1,
  transparent: d.transparent === true,
  blending: d.blending ?? 'normal',
  forceSinglePass: d.forceSinglePass === true,
  transparentShadow: d.transparentShadow === true,
  depthTest: d.depthTest !== false,
  depthWrite: d.depthWrite !== false,
  flatShading: d.flatShading === true,
  forVertexTangents: d.forVertexTangents,
  shininess: d.family === 'phong' ? (d.shininess ?? DEFAULT_SHININESS) : undefined,
  specular: d.family === 'phong' ? rgb(d.specular ?? PHONG_SPECULAR) : undefined,
})

/** Fills `into` from `d`; a map its model never reads is refused by name. */
function fill(into: PageSurface, d: SurfaceDeclaration) {
  const unread = unreadMapRefusal(d)
  if (unread) throw new Error(unread)
  const read = reading(d)
  return Object.assign(
    into,
    factors(d, read),
    slots(d, read),
    relief(d, read),
    lobes(d, read),
    { model: read.model },
    shape(d),
    raster(d),
  )
}

/** The record of a surface declared `d`, at version 0. */
export const declareSurface = (d: SurfaceDeclaration): PageSurface =>
  fill(Object.assign(new Releasable(), { version: 0 }) as PageSurface, d)

/** Fills `record` again from `d`, in place, and journals the write: every holder sees it. */
export function redeclareSurface(record: PageSurface, d: SurfaceDeclaration) {
  fill(record, d)
  surfaceWritten(record)
}

/** A record of its own with the fields of `record` — a variant a geometry asks for, its fields
 *  written after — at version 0. */
export function copySurface(record: PageSurface): PageSurface {
  const { released: _released, version: _version, ...fields } = record
  return Object.assign(new Releasable(), fields, { version: 0 }) as PageSurface
}
