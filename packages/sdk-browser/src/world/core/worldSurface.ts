/**
 * THE SURFACE OF A WORLD'S MATERIAL: the family its kind names, as the engine's own surface.
 *
 * A physical kind is the engine's own record, on a standard or physical surface
 * (`worldPhysicalSurface.ts`). Every other kind is the family of the same name — basic, Lambert,
 * Phong, toon, normal, matcap, depth —, which the engine maps onto its one lighting model on the
 * WebGPU path (`surfaceModel.ts`), where the bench witness draws each as it is. Lines, points and sprites are unlit: they wear a basic surface.
 */
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import { LINE_DEPTH_LAYER, depthLayerUnits } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { hostSide } from '../../scene/materialSide.ts'
import { composesWithBackground, hostBlending } from '../../scene/materialBlending.ts'
import { GraphSurface, type GraphSurfaceFamily } from '../../host/graph/surface.ts'
import { physicalSurface, writePhysical } from './worldPhysicalSurface.ts'
import { alphaModeOf } from '../../../../sdk-core/src/contracts/material.ts'
import {
  COLOUR_MAPS,
  HOST_MAPS,
  hostTexture,
  repaintHostMaps,
  type HostTextures,
} from './worldTextures.ts'

/** The family of each kind that is not physical. */
const FAMILY: Record<string, GraphSurfaceFamily> = {
  meshBasic: 'basic',
  line: 'basic',
  lineDashed: 'basic',
  points: 'basic',
  sprite: 'basic',
  shadow: 'basic',
  meshLambert: 'lambert',
  meshPhong: 'phong',
  meshToon: 'toon',
  meshNormal: 'normal',
  meshMatcap: 'matcap',
  meshDepth: 'depth',
}
/** Colours a family may carry, written in the linear working space both sides share. */
const COLOURS = ['color', 'emissive', 'specular', 'subsurfaceColor']

/** Writes the colours a surface has, its glow scaled by its intensity, and its shininess. */
function writeColours(surface: GraphSurface, material: Material) {
  for (const field of COLOURS) {
    const colour = material[field] as { r: number; g: number; b: number } | undefined
    const into = surface[field] as Color | undefined
    if (colour && into?.isColor) into.setRGB(colour.r, colour.g, colour.b)
  }
  const emissive = surface.emissive as Color | undefined
  if (emissive?.isColor) emissive.multiplyScalar(material.emissiveIntensity)
  if (typeof material.shininess === 'number' && 'shininess' in surface)
    surface.shininess = material.shininess
}

/** A non-physical family, its fields written from the material's where the family has them. */
function familySurface(family: GraphSurfaceFamily, material: Material, vertexColors: boolean) {
  const surface = new GraphSurface(family)
  writeColours(surface, material)
  surface.opacity = material.opacity
  surface.transparent = material.transparent
  surface.alphaTest = material.alphaTest
  surface.side = hostSide(material.side)
  surface.vertexColors = vertexColors
  return surface
}

/** A dashed line's dash and gap along its distance (`lineDash`, `../../visibility/shader/lineWgsl.ts`),
 *  its `scale` folded in: the distance stretches by it, the same as shortening both.
 *  A `scale` of zero or less stretches the dash to infinity, a solid line: a dash of
 *  zero, which `lineDash` keeps whole. */
function writeDash(surface: GraphSurface, material: Material) {
  const scale = (material.scale as number | undefined) ?? 1
  const solid = !(scale > 0)
  surface.dashSize = solid ? 0 : ((material.dashSize as number | undefined) ?? 0) / scale
  surface.gapSize = solid ? 0 : ((material.gapSize as number | undefined) ?? 0) / scale
}

/** A line's width in CSS pixels, 1 by default. A value, so a repaint writes it again. */
function writeLineWidth(surface: GraphSurface, material: Material) {
  surface.lineWidth = (material.linewidth as number | undefined) ?? 1
}

/** Both sides in one pass, for a quad the rasters lay on screen (a line's, a sprite's): it has no
 *  face to cull, and a transparent one drawn back then front would take two entries of the
 * transparent plan, whose per-frame ranking grows with the square of their count. */
function drawBothSidesOnce(surface: GraphSurface) {
  surface.side = hostSide('double')
  surface.forceSinglePass = true
}

/**
 * The raster state of a surface that draws line quads (`drawn.ts`): its `linewidth` in CSS
 * pixels (the rasters scale it by the host's pixel ratio each frame), a dashed line's dash and
 * gap, both sides in one pass — a quad widened on screen has no face to cull —, and one
 * coplanar layer over the faces the lines lie on: the pages the world cuts for it carry the layer
 * on WebGPU (`../page/runtimePrimitive.ts`), and this polygon offset gives it on WebGL2, signed
 * for its forward depth (nearer is smaller).
 */
function drawLines(surface: GraphSurface, material: Material) {
  writeLineWidth(surface, material)
  if (material.kind === 'lineDashed') writeDash(surface, material)
  drawBothSidesOnce(surface)
  surface.polygonOffset = true
  surface.polygonOffsetFactor = 0
  surface.polygonOffsetUnits = -depthLayerUnits(LINE_DEPTH_LAYER)
}

/** A sprite's turn in the image, as its material says it: its `rotation`, 0 by
 *  default. A value, so a repaint writes it again. */
function writeSpriteTurn(surface: GraphSurface, material: Material) {
  surface.rotation = (material.rotation as number | undefined) ?? 0
}

/**
 * The raster state of a surface that draws a sprite's quad (`drawnSprite`), which every raster
 * turns to face the camera (`../../visibility/shader/spriteWgsl.ts`): its turn, its size rule —
 * its `sizeAttenuation`, true by default —, and both sides in one pass — a quad turned
 * toward the camera has no back to cull. The size rule is written here only: it sets the sprite's
 * root mark, taken once when the session collects its roots (`spriteMark`), so a material that
 * changes it is a new entry and a new session, never a repaint (`worldMaterials.ts`).
 */
function drawSprite(surface: GraphSurface, material: Material) {
  surface.sprite = true
  writeSpriteTurn(surface, material)
  surface.sizeAttenuation = material.sizeAttenuation !== false
  drawBothSidesOnce(surface)
}

/** What a mesh draws of its geometry: faces, line quads (`drawLines`), a sprite's quad, or a
 *  cloth's faces (`sheet`), seen from both sides: every pass that draws them — the visibility and
 *  material passes, the shadows they cast, WebGL2 — culls neither face and turns the normal of a
 *  back face toward the eye, off this one side. A blended cloth keeps its two passes, back then
 *  front, as a blended double-sided surface does. */
export type SurfaceReading = 'faces' | 'lines' | 'sprite' | 'sheet'

/** The surface of a world material, with its maps and raster state, for what the mesh wearing it
 *  draws. */
export function hostSurface(
  material: Material,
  vertexColors: boolean,
  textures: HostTextures,
  reading: SurfaceReading = 'faces',
) {
  const family = FAMILY[material.kind]
  const surface = family
    ? familySurface(family, material, vertexColors)
    : physicalSurface(material, vertexColors)
  for (const field of HOST_MAPS) {
    const texture = material[field] as Texture | undefined
    if (texture?.isTexture && field in surface)
      surface[field] = hostTexture(texture, COLOUR_MAPS.has(field), textures)
  }
  if ('flatShading' in surface) surface.flatShading = material.flatShading === true
  surface.depthWrite = material.depthWrite
  surface.depthTest = material.depthTest
  surface.transparentShadow = material.transparentShadow === true
  // A mode that composes with the background is drawn in the transparent pass, whatever
  // `transparent` says: the opaque pass has nothing behind to add to.
  surface.blending = hostBlending(material.blending)
  if (composesWithBackground(material.blending)) surface.transparent = true
  if (reading === 'lines') drawLines(surface, material)
  if (reading === 'sprite') drawSprite(surface, material)
  if (reading === 'sheet') surface.side = hostSide('double')
  return surface
}

/**
 * Writes a material's value fields — colours, glow, metalness, roughness, shininess, opacity,
 * cutoff, physical extensions and the family they put a physical kind in, a line's width, a
 * dashed line's dash and gap, a sprite's turn — and its maps' sampling into the surface built for
 * it, as `hostSurface` wrote them, and bumps the surface's version: every reader of the surface
 * (`page/surface.ts`) takes them at its next read, nothing built again. A map whose
 * version moved sends its picture again; one whose placement alone moved is placed again,
 * nothing sent (`repaintHostMaps`).
 */
export function repaintHostSurface(surface: GraphSurface, material: Material) {
  repaintHostMaps(surface as unknown as Record<string, unknown>, material)
  writeColours(surface, material)
  if (typeof surface.metalness === 'number') surface.metalness = material.metalness
  if (typeof surface.roughness === 'number') surface.roughness = material.roughness
  surface.opacity = material.opacity
  // A physical kind's record cuts only a masked surface (`hostPageSurface`), a family its own.
  const family = FAMILY[material.kind]
  const cut = family || alphaModeOf(material) === 'mask'
  surface.alphaTest = cut ? material.alphaTest : 0
  if (!family) writePhysical(surface, material)
  if (typeof surface.lineWidth === 'number') writeLineWidth(surface, material)
  if (typeof surface.dashSize === 'number') writeDash(surface, material)
  if (surface.sprite === true) writeSpriteTurn(surface, material)
  surface.needsUpdate = true
}
