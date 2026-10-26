/**
 * THE ONE SURFACE RECORD OF A MATERIAL, written by its owner from what it declares.
 *
 * A world material (`../../session/world/materials/surface.ts`), a table material
 * (`../../scene/host/prepared/materials.ts`) and a material a page creates (`../../session/host/pageObjects.ts`) each
 * declare their surface once, in the engine's words, and get back the record every mesh wearing
 * them holds and every reader reads in place — the page rows, the tile pools, the transparent
 * items, the proxy surfaces. The declaration is an argument, never kept: there is no second object
 * per material to copy from or to follow. A rewrite fills the same record again and journals it
 * (`surfaceWrites.ts`), so a holder sees the new fields with no lookup and a consumer visits only
 * the records written.
 *
 * What each family reads of a declaration is decided here once: Lambert and toon lit apart, Phong
 * as the physical model at the roughness of its exponent, the others unlit
 * (`../../materials/surface/surfaceModel.ts`); a field a family does not read is left at its silent value.
 */
import { subsurfaceProfileRow } from '../../lighting/subsurface/registry.ts'
import { saturate } from '../../../../math/src/scalar/reals.ts'
import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import {
  isThinTranslucentGraph,
  isWaterGraph,
  GRAPH_SHADING_MODELS,
} from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { DEFAULT_IOR, DEFAULT_SHININESS } from '../../../../sdk-core/src/world/material/defaults.ts'
import { DEFAULT_TRANSLUCENCY_LIGHTING } from '../../../../sdk-core/src/world/constants/index.ts'
import { Releasable } from '../../../../sdk-core/src/runtime/releasable.ts'
import { SURFACE_MODEL } from '../../materials/surface/surfaceModelWord.ts'
import {
  familyModel,
  litFamily,
  metalRoughFamily,
  shininessRoughness,
  unreadMapRefusal,
} from '../../materials/surface/surfaceModel.ts'
import { PIXEL_MODEL, shadingModelOfName } from '../../materials/surface/pixelModel.ts'
import type { PageSurface, SurfaceFamily } from './surface.ts'
import type { Slot, SurfaceDeclaration, SurfaceColour } from './surfaceDeclaration.ts'
import { surfaceWritten } from './surfaceWrites.ts'

type Rgb = [number, number, number]

const WHITE: SurfaceColour = { r: 1, g: 1, b: 1 }
/** A Phong surface's highlight colour when it declares none. */
const PHONG_SPECULAR = new Color(0x111111)
/** The families that carry a base colour: a normal or depth surface shows something else. */
const UNCOLOURED = new Set<SurfaceFamily>(['normal', 'depth'])

const rgb = (colour: SurfaceColour): Rgb => [colour.r, colour.g, colour.b]
const mapIf = (on: boolean, texture: Slot) => (on ? (texture ?? undefined) : undefined)
const valueIf = (on: boolean, value: number | undefined, fallback: number, off = 0) =>
  on ? (value ?? fallback) : off
const colourIf = (on: boolean, colour: SurfaceColour | undefined, fallback: number): Rgb =>
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

/** The subsurface colour of a cloth's faces (`sheet`) or of a pixel model that holds one (`coloured`: the skin, the thin subsurface):
 *  its colour, white where its graph wires the colour (the graph gives its value per pixel), black where it has none. */
const thinColour = (d: SurfaceDeclaration, sheet: boolean, coloured: boolean): Rgb =>
  sheet && d.graph?.outputs.subsurfaceColor
    ? [1, 1, 1]
    : colourIf(sheet || coloured, d.subsurfaceColor, 0)

/** Whether a model holds a subsurface colour of the material's: the skin and the thin subsurface. */
const holdsColour = (model: number | undefined) =>
  model === PIXEL_MODEL.skin || model === PIXEL_MODEL.subsurface

/** The shading model a lit standard surface gives its pixels without a graph's (`pixelModelOfName`); none where its graph decides. */
const modelOf = (d: SurfaceDeclaration, { lit, standard }: Reading) => {
  const model =
    d.shadingModel === 'fromMaterialExpression' ? undefined : shadingModelOfName(d.shadingModel)
  return lit && (standard || model === GRAPH_SHADING_MODELS.unlit) ? model : undefined
}

/** The opacity byte of a thin subsurface or of a shading model: an eye's is one minus its iris mask. */
const modelOpacity = (d: SurfaceDeclaration, model: number | undefined) =>
  saturate(model === PIXEL_MODEL.eye ? 1 - (d.irisMask ?? 1) : (d.subsurfaceOpacity ?? 1))

/** Its fog, its translucency lighting and shadows, its cutout and its vertex offset. */
const renderSettings = (d: SurfaceDeclaration) => ({
  fog: d.fog !== false,
  cloudFog: d.fog !== false && d.cloudFog === true,
  computeFogPerPixel: d.computeFogPerPixel === true,
  translucentLocalLightShadow: d.translucentLocalLightShadow === true,
  translucentLocalLightShadowQuality: d.translucentLocalLightShadowQuality ?? 0,
  translucentDirectionalLightShadowQuality: d.translucentDirectionalLightShadowQuality ?? 0,
  translucencyLighting: d.translucencyLighting ?? DEFAULT_TRANSLUCENCY_LIGHTING,
  translucencyPass: d.translucencyPass ?? 'afterDepthOfField',
  allowNegativeEmissive: d.allowNegativeEmissive === true,
  opacityMaskClipValue: d.opacityMaskClipValue,
  ditherOpacityMask: d.ditherOpacityMask === true,
  normalCurvatureToRoughness: d.normalCurvatureToRoughness === true,
  maxWorldPositionOffset: d.maxWorldPositionOffset ?? 0,
  alwaysEvaluateWorldPositionOffset: d.alwaysEvaluateWorldPositionOffset === true,
})

/** Its colours, its glow scaled by its intensity, its metal and roughness — a Phong surface's
 *  read off its exponent —, its side and alpha. */
function factors(d: SurfaceDeclaration, reader: Reading) {
  const { lit, side, standard, sheet } = reader
  const model = modelOf(d, reader)
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
    ...renderSettings(d),
    responsive: d.responsive,
    side,
    alphaTest: d.alphaTest ?? 0,
    emissive: emissive ? (rgb(emissive).map((c) => c * glow) as Rgb) : ([0, 0, 0] as Rgb),
    subsurfaceColor: thinColour(d, sheet, holdsColour(model)),
    subsurfaceOpacity: sheet || model !== undefined ? modelOpacity(d, model) : 1,
    shadingModel: model,
    irisDistance: model === PIXEL_MODEL.eye ? saturate(d.irisDistance ?? 0.1) : 0,
    modelFromGraph: d.shadingModel === 'fromMaterialExpression',
    subsurfaceProfile: lit ? subsurfaceProfileRow(d.subsurfaceProfile) : 0,
    vertexColors: d.vertexColors === true,
  }
}

/** Its map slots, each read only by a model that samples it. */
function slots(d: SurfaceDeclaration, reader: Reading) {
  const { model, lit, standard, physical, sheet } = reader
  return {
    map:
      model === SURFACE_MODEL.matcap ? mapIf(true, d.matcap) : mapIf(d.family !== 'normal', d.map),
    metalnessMap: mapIf(standard, d.metalnessMap),
    roughnessMap: mapIf(standard, d.roughnessMap),
    normalMap: mapIf(lit, d.normalMap),
    aoMap: mapIf(lit, d.aoMap),
    emissiveMap: mapIf(lit, d.emissiveMap),
    subsurfaceMap: mapIf(sheet || modelOf(d, reader) === PIXEL_MODEL.subsurface, d.subsurfaceMap),
    anisotropyMap: mapIf(physical, d.anisotropyMap),
    clearcoatMap: mapIf(physical, d.clearcoatMap),
    clearcoatRoughnessMap: mapIf(physical, d.clearcoatRoughnessMap),
    clearcoatNormalMap: mapIf(physical, d.clearcoatNormalMap),
    specularIntensityMap: mapIf(
      physical && d.specularIntensity !== undefined,
      d.specularIntensityMap,
    ),
    displacementMap: mapIf(d.displacement !== undefined, d.displacementMap),
  }
}

/** Its displacement: the numbers it declares, only with the height they displace by — a map or the
 *  `displacement` output of its graph; a surface that declares either alone is drawn flat. */
const displaced = (d: SurfaceDeclaration) => ({
  displacement:
    d.displacement && (d.displacementMap || d.graph?.outputs.displacement)
      ? d.displacement
      : undefined,
})

/** Its normal factors. A page that stores no tangent (`FLAG_TANGENT`) has every engine pass rebuild
 *  the frame from its triangle, which turns the second factor of a surface written for vertex
 *  tangents (`forVertexTangents`); a pass reading vertex tangents takes the factor as written. */
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

/** Whether it is thin translucent: a lit surface whose graph wires a thin translucent output.
 *  Its record transmits (transmission one), which draws it as a thin layer; the layer reads the
 *  graph's outputs, not the amount. */
const thinOf = (d: SurfaceDeclaration, lit: boolean) =>
  lit && GRAPH_FAMILIES.has(d.family) && isThinTranslucentGraph(d.graph?.outputs)

/** Its physical lobes and volume: silent on any other family. Zero says "no attenuation" without
 *  shipping an infinity as far as a uniform. */
function lobes(d: SurfaceDeclaration, { physical, lit }: Reading) {
  return {
    anisotropy: valueIf(physical, d.anisotropy, 0),
    anisotropyRotation: valueIf(physical, d.anisotropyRotation, 0),
    clearcoat: valueIf(physical, d.clearcoat, 0),
    clearcoatRoughness: valueIf(physical, d.clearcoatRoughness, 0),
    specularIntensity: physical ? d.specularIntensity : undefined,
    transmission: thinOf(d, lit) ? 1 : valueIf(physical, d.transmission, 0),
    ior: valueIf(physical, d.ior, DEFAULT_IOR, DEFAULT_IOR),
    // A glTF material refracts only when it declares its ior, or its graph wires a refraction: the
    // default 1.5 is there for Fresnel, and bending every transmissive surface by it would distort
    // what never asked to.
    refracts: physical && (d.ior !== undefined || !!d.graph?.outputs.refraction),
    thickness: valueIf(physical, d.thickness, 0),
    attenuationDistance:
      physical && Number.isFinite(d.attenuationDistance) ? d.attenuationDistance! : 0,
    attenuationColor: colourIf(physical, d.attenuationColor, 1),
  }
}

/** Its cloth: the sheen of a physical surface, which the cloth shading model draws (fuzz colour, cloth
 *  amount, their maps) unless a transmission or a clear coat takes the surface first — the model is
 *  one or the other. Silent on any other surface. */
function cloth(d: SurfaceDeclaration, { physical }: Reading) {
  const on =
    physical && (d.sheen ?? 0) > 0 && !((d.transmission ?? 0) > 0) && !((d.clearcoat ?? 0) > 0)
  return {
    sheen: on ? 1 : 0,
    sheenColor: colourIf(on, d.sheenColor, 0),
    sheenRoughness: valueIf(on, d.sheenRoughness, 0),
    sheenColorMap: mapIf(on, d.sheenColorMap),
    sheenRoughnessMap: mapIf(on, d.sheenRoughnessMap),
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
  // A shadow catcher is the image behind it, darkened where a shadow falls: always blended.
  transparent: d.transparent === true || d.family === 'shadow',
  blending: d.blending ?? 'normal',
  twoSidedPasses: d.twoSidedPasses === true,
  depthTest: d.depthTest !== false,
  depthWrite: d.depthWrite !== false,
  flatShading: d.flatShading === true,
  forVertexTangents: d.forVertexTangents,
  shininess: d.family === 'phong' ? (d.shininess ?? DEFAULT_SHININESS) : undefined,
  specular: d.family === 'phong' ? rgb(d.specular ?? PHONG_SPECULAR) : undefined,
})

/** The families that draw the material's colour, and so can wear a graph: a normal, depth, matcap or
 *  shadow surface shows something other than what a graph computes. */
const GRAPH_FAMILIES = new Set<SurfaceFamily>([
  'basic',
  'standard',
  'physical',
  'lambert',
  'phong',
  'toon',
])

/** Its graph, on a family that draws the material's colour. */
const graphOf = (d: SurfaceDeclaration) => ({
  graph: GRAPH_FAMILIES.has(d.family) ? d.graph : undefined,
})

/** Whether it is single-layer water: a lit surface whose graph wires a water output. */
const waterOf = (d: SurfaceDeclaration, { lit }: Reading) => ({
  water: lit && GRAPH_FAMILIES.has(d.family) && isWaterGraph(d.graph?.outputs),
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
    cloth(d, read),
    displaced(d),
    { model: read.model },
    graphOf(d),
    waterOf(d, read),
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
