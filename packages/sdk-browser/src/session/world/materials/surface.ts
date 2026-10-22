/**
 * THE SURFACE OF A WORLD'S MATERIAL: the family its kind names, declared as the engine's own
 * surface record (`../../../geometry/pages/surfaceRecord.ts`).
 *
 * A physical kind declares the engine's material parameters, on a standard or physical surface
 * (`physicalSurface.ts`). Every other kind is the family of the same name — basic, Lambert,
 * Phong, toon, normal, matcap, depth, the shadow catcher —, which the engine maps onto its one
 * lighting model on the WebGPU path (`surfaceModel.ts`), where the bench witness draws each as it
 * is. Lines, points and sprites are unlit: they wear a basic surface.
 */
import { MATERIAL_COLOURS, Material } from '../../../../../sdk-core/src/world/material/material.ts'
import { isLightFunctionMaterial } from '../../../../../sdk-core/src/world/material/lightFunctionMaterial.ts'
import type { Texture } from '../../../../../sdk-core/src/world/texture/texture.ts'
import { composesWithBackground } from '../../../materials/surface/materialBlending.ts'
import { physicalDeclaration } from './physicalSurface.ts'
import { TABLE_SLOTS } from '../../../../../sdk-core/src/scene/core/tableSurfaces.ts'
import { PHYSICAL_MAP_FIELDS } from '../../../visibility/materialType.ts'
import type { PageSurface, SurfaceFamily } from '../../../geometry/pages/surface.ts'
import { declareSurface, redeclareSurface } from '../../../geometry/pages/surfaceRecord.ts'
import type { SurfaceDeclaration } from '../../../geometry/pages/surfaceDeclaration.ts'

/** Material fields that hold a texture, by the name both sides give them: a surface holds the
 *  material's texture record itself, so a write of the texture reaches every reader with no copy. */
const MAPS = [
  ...TABLE_SLOTS,
  'alphaMap',
  'matcap',
  'gradientMap',
  'subsurfaceMap',
  ...PHYSICAL_MAP_FIELDS,
]

/** The family of each kind that is not physical. */
const FAMILY: Record<string, SurfaceFamily> = {
  meshBasic: 'basic',
  line: 'basic',
  lineDashed: 'basic',
  points: 'basic',
  sprite: 'basic',
  shadow: 'shadow',
  meshLambert: 'lambert',
  meshPhong: 'phong',
  meshToon: 'toon',
  meshNormal: 'normal',
  meshMatcap: 'matcap',
  meshDepth: 'depth',
}

/** A non-physical family: the colours the material holds, its glow by its intensity, its
 *  shininess, its alpha and its side. */
function familyDeclaration(family: SurfaceFamily, material: Material, vertexColors: boolean) {
  const declared: Record<string, unknown> = { family }
  for (const field of MATERIAL_COLOURS) if (material[field]) declared[field] = material[field]
  return Object.assign(declared, {
    emissiveIntensity: material.emissiveIntensity,
    shininess: typeof material.shininess === 'number' ? material.shininess : undefined,
    opacity: material.opacity,
    transparent: material.transparent,
    alphaTest: material.alphaTest,
    side: material.side,
    vertexColors,
  })
}

/** A dashed line's dash and gap along its distance (`lineDash`, `../../../visibility/shader/lineWgsl.ts`),
 *  its `scale` folded in: the distance stretches by it, the same as shortening both.
 *  A `scale` of zero or less stretches the dash to infinity, a solid line: a dash of
 *  zero, which `lineDash` keeps whole. */
function dash(material: Material) {
  const scale = (material.scale as number | undefined) ?? 1
  const solid = !(scale > 0)
  return {
    dashSize: solid ? 0 : ((material.dashSize as number | undefined) ?? 0) / scale,
    gapSize: solid ? 0 : ((material.gapSize as number | undefined) ?? 0) / scale,
  }
}

/** Both sides in one pass, for a quad the rasters lay on screen (a line's, a sprite's): it has no
 *  face to cull, and a transparent one drawn back then front would take two entries of the
 * transparent plan, whose per-frame ranking grows with the square of their count. */
const BOTH_SIDES_ONCE = { side: 'double', forceSinglePass: true } as const

/**
 * What a surface that draws line quads (`drawn.ts`) or a sprite's quad adds. A line: its
 * `linewidth` in CSS pixels (the rasters scale it by the host's pixel ratio each frame), a dashed
 * line's dash and gap, both sides in one pass — the coplanar layer over the faces the lines lie on
 * is the pages' own (`../../../geometry/runtime/runtimePrimitive.ts`). A sprite, which every raster turns to face the
 * camera (`../../../visibility/shader/spriteWgsl.ts`): its turn, its size rule — its
 * `sizeAttenuation`, true by default —, and both sides in one pass. The size rule sets the sprite's
 * root mark, taken once when the session collects its roots (`spriteMark`), so a material that
 * changes it is a new entry and a new session, never a repaint (`materials.ts`). A cloth's
 * faces (`sheet`) are drawn on both sides.
 */
function readingFields(material: Material, reading: SurfaceReading) {
  if (reading === 'lines')
    return {
      lineWidth: (material.linewidth as number | undefined) ?? 1,
      ...(material.kind === 'lineDashed' ? dash(material) : {}),
      ...BOTH_SIDES_ONCE,
    }
  if (reading === 'sprite')
    return {
      sprite: true,
      rotation: (material.rotation as number | undefined) ?? 0,
      sizeAttenuation: material.sizeAttenuation !== false,
      ...BOTH_SIDES_ONCE,
    }
  return reading === 'sheet' ? { side: 'double' } : {}
}

/** What a mesh draws of its geometry: faces, line quads, a sprite's quad, or a cloth's faces
 *  (`sheet`), seen from both sides: every pass that draws them — the visibility and material
 *  passes, the shadows they cast — culls neither face and turns the normal of a back face toward
 *  the eye, off this one side. A blended cloth keeps its two passes, back then front, as a blended
 *  double-sided surface does. */
export type SurfaceReading = 'faces' | 'lines' | 'sprite' | 'sheet'

/** What a mesh draws with a material of a domain that has no surface — a light function's —: the
 *  default material, white and unlit, which a mesh made with no material wears. */
const DEFAULT_MATERIAL = new Material('meshBasic')

/** What a world material declares, with its maps and raster state, for what the mesh wearing it
 *  draws: a material of the light function domain is drawn as the default material. */
function worldDeclaration(
  worn: Material,
  vertexColors: boolean,
  reading: SurfaceReading,
): SurfaceDeclaration {
  const material = isLightFunctionMaterial(worn) ? DEFAULT_MATERIAL : worn
  const family = FAMILY[material.kind]
  const declared: Record<string, unknown> = family
    ? familyDeclaration(family, material, vertexColors)
    : physicalDeclaration(material, vertexColors)
  for (const field of MAPS) {
    const texture = material[field] as Texture | undefined
    if (texture?.isTexture) declared[field] = texture
  }
  return Object.assign(declared, {
    flatShading: material.flatShading === true,
    graph: material.domain === 'surface' ? material.graph : undefined,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
    transparentShadow: material.transparentShadow === true,
    blending: material.blending,
    // A mode that composes with the background is drawn in the transparent pass, whatever
    // `transparent` says: the opaque pass has nothing behind to add to.
    ...(composesWithBackground(material.blending) ? { transparent: true } : {}),
    ...readingFields(material, reading),
  }) as SurfaceDeclaration
}

/** How each rank of a material entry's plain surfaces reads its triangles (`materials.ts`):
 *  faces, lines, a sprite, a cloth's faces. A cloth is a reading of its own, not a two-sided variant:
 *  both faces make a lit surface read its subsurface colour and map (`geometry/pages/surfaceRecord.ts`). */
export const RANK_READINGS: readonly SurfaceReading[] = ['faces', 'lines', 'sprite', 'sheet']

/** The plain surface of a world material, for what the mesh wearing it draws: no vertex colour,
 *  which its tinted variant adds (`geometry/pages/surfaceVariant.ts`). */
export const hostSurface = (material: Material, reading: SurfaceReading = 'faces') =>
  declareSurface(worldDeclaration(material, false, reading))

/**
 * Declares the surface built for `material` again, in place, and journals it: its values —
 * colours, glow, metalness, roughness, shininess, opacity, cutoff, physical extensions and the
 * family they put a physical kind in, a line's width, a dashed line's dash and gap, a sprite's
 * turn — reach every reader (`geometry/pages/surface.ts`) at its next read, nothing built again. A sprite's
 * size rule stays the one it was built with (`readingFields`). Its maps are the material's texture
 * records themselves: their pictures, sampling and placement need no write. It is read as its
 * rank in the entry says (`RANK_READINGS`), with the vertex colours it was worn with — a tinted
 * variant keeps its own.
 */
export function repaintHostSurface(
  surface: PageSurface,
  material: Material,
  reading: SurfaceReading,
) {
  const declared = worldDeclaration(material, surface.vertexColors === true, reading)
  const sizeAttenuation = surface.sprite?.sizeAttenuation ?? declared.sizeAttenuation
  redeclareSurface(surface, { ...declared, sizeAttenuation })
}
