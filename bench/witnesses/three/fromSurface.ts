/**
 * THE ENGINE'S SURFACE RECORDS, HANDED TO THE WITNESS RENDERER: each record
 * (`packages/sdk-browser/src/page/surface.ts`) drawn as the library's material of the family it was
 * declared in — a Lambert, Phong or toon surface as the library lights that family, never through
 * the engine's one model. One copy per record, made on first request, painted again at every
 * request and recompiled when the record's version moved. Every number is the record's.
 */
import * as THREE from 'three'
import type { Blending } from '../../../packages/sdk-core/src/world/constants/index.ts'
import { COLOUR_MAPS } from '../../../packages/sdk-core/src/world/material/material.ts'
import type { HostMaterials } from '../../../packages/sdk-browser/src/host/resources.ts'
import type { PageSurface, SurfaceFamily } from '../../../packages/sdk-browser/src/page/surface.ts'
import { follow, threeTexture } from './fromGraph.ts'

type Held = { made: THREE.Material; version: number }
const surfaces = new WeakMap<PageSurface, Held>()

/** The family each engine surface is drawn as. */
const FAMILIES: Record<SurfaceFamily, new () => THREE.Material> = {
  basic: THREE.MeshBasicMaterial,
  standard: THREE.MeshStandardMaterial,
  physical: THREE.MeshPhysicalMaterial,
  lambert: THREE.MeshLambertMaterial,
  phong: THREE.MeshPhongMaterial,
  toon: THREE.MeshToonMaterial,
  normal: THREE.MeshNormalMaterial,
  matcap: THREE.MeshMatcapMaterial,
  depth: THREE.MeshDepthMaterial,
}
/** The engine's blending words in the library's numbers. */
const BLENDINGS: Record<Blending, THREE.Blending> = {
  none: THREE.NoBlending,
  normal: THREE.NormalBlending,
  additive: THREE.AdditiveBlending,
  subtractive: THREE.SubtractiveBlending,
  multiply: THREE.MultiplyBlending,
}

type Rgb = readonly [number, number, number]
const colour = (rgb: Rgb) => ({ r: rgb[0], g: rgb[1], b: rgb[2] })

/**
 * The library's parameters of a record, under the library's names. A normal factor is handed
 * back in the frame it was declared for (`forVertexTangents`): the record keeps it turned for the
 * engine, which rebuilds every frame from the triangle.
 */
function parameters(s: PageSurface): Record<string, unknown> {
  const turned = s.forVertexTangents ? -1 : 1,
    coat = s.clearcoatNormalScale ?? [1, 1]
  return {
    name: s.name,
    side: s.doubleSided ? THREE.DoubleSide : s.backSide ? THREE.BackSide : THREE.FrontSide,
    ...{ transparent: s.transparent, opacity: s.opacity, alphaTest: s.alphaTest },
    ...{ blending: BLENDINGS[s.blending], forceSinglePass: s.forceSinglePass },
    ...{ depthTest: s.depthTest, depthWrite: s.depthWrite, flatShading: s.flatShading },
    ...{ vertexColors: s.vertexColors === true, fog: s.fog !== false },
    color: colour(s.baseColor),
    [s.family === 'matcap' ? 'matcap' : 'map']: s.map ?? null,
    ...{ metalness: s.metalness, roughness: s.roughness },
    ...{ metalnessMap: s.metalnessMap ?? null, roughnessMap: s.roughnessMap ?? null },
    normalMap: s.normalMap ?? null,
    normalScale: {
      x: s.normalScale,
      y: s.forVertexTangents ? s.tangentNormalScaleY : s.normalScaleY,
    },
    ...{ aoMap: s.aoMap ?? null, aoMapIntensity: s.aoIntensity },
    ...{ emissive: colour(s.emissive), emissiveMap: s.emissiveMap ?? null },
    ...(s.family === 'phong' ? { shininess: s.shininess, specular: colour(s.specular!) } : {}),
    ...(s.family === 'physical' ? physical(s, coat, turned) : {}),
  }
}

/** A physical record's volume, clear coat and anisotropy; no attenuation is an infinite one. */
const physical = (s: PageSurface, coat: readonly [number, number], turned: number) => ({
  ...{ transmission: s.transmission, ior: s.ior, thickness: s.thickness },
  ...{ attenuationDistance: s.attenuationDistance || Infinity },
  attenuationColor: colour(s.attenuationColor),
  ...{ clearcoat: s.clearcoat ?? 0, clearcoatRoughness: s.clearcoatRoughness ?? 0 },
  ...{
    clearcoatMap: s.clearcoatMap ?? null,
    clearcoatRoughnessMap: s.clearcoatRoughnessMap ?? null,
  },
  ...{ clearcoatNormalMap: s.clearcoatNormalMap ?? null },
  clearcoatNormalScale: { x: coat[0], y: coat[1] * turned },
  ...{ anisotropy: s.anisotropy ?? 0, anisotropyRotation: s.anisotropyRotation ?? 0 },
  anisotropyMap: s.anisotropyMap ?? null,
})

/** Writes a record's parameters into the library's material, the ones its family has; a texture
 *  record crosses through `texture`, the library's copy unless said otherwise. */
function paint(
  into: THREE.Material,
  surface: PageSurface,
  texture: (record: never, colour: boolean) => unknown = threeTexture,
) {
  const target = into as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(parameters(surface))) {
    if (!(key in into)) continue
    const held = target[key] as { isColor?: boolean; isVector2?: boolean } | null
    const given = value as Record<'r' | 'g' | 'b' | 'x' | 'y', number> & { isTexture?: boolean }
    if (given?.isTexture) target[key] = texture(value as never, COLOUR_MAPS.has(key))
    else if (held?.isColor) (held as THREE.Color).setRGB(given.r, given.g, given.b)
    else if (held?.isVector2) (held as THREE.Vector2).set(given.x, given.y)
    else target[key] = value
  }
}

/** The library's material of `surface`'s family, painted from it, its texture records left as
 *  they are: the record read under the library's names, as a loader's surface is compared. */
export function threeView(surface: PageSurface) {
  const view = new FAMILIES[surface.family]()
  paint(view, surface, (record) => record)
  return view
}

/** The library's surface of an engine record, kept in step with its version. */
function threeMaterial(surface: PageSurface | THREE.Material): THREE.Material {
  if (surface instanceof THREE.Material) return surface
  let held = surfaces.get(surface)
  if (!held) {
    held = { made: new FAMILIES[surface.family](), version: -1 }
    surfaces.set(surface, held)
    follow(surface, held.made)
  }
  // Painted at every request: a texture it samples may have changed without the surface.
  paint(held.made, surface)
  if (held.version >= 0 && held.version !== surface.version) held.made.needsUpdate = true
  held.version = surface.version
  return held.made
}

/** One surface or one per geometry group, each handed to the library. */
export function threeMaterials(declared: HostMaterials | THREE.Material | THREE.Material[]) {
  return Array.isArray(declared)
    ? (declared as (PageSurface | THREE.Material)[]).map(threeMaterial)
    : threeMaterial(declared)
}
