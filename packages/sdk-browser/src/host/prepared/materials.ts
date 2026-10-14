/**
 * The surface records of the prepared scene, declared from the material table under the rules the
 * host loader applied (`../../page/surfaceRecord.ts`), so a host renderer draws them alike:
 *
 * - `unlit` is the host's basic surface, `physical` its physical one, anything else standard;
 * - a blended surface is transparent and writes no depth, a masked one cuts at `alphaTest`;
 * - the table entry already carries the tangent variant (`normalScaleY`); the variants a primitive
 *   adds — vertex colours, flat shading where it has no normal, both faces where a cloth draws
 *   it — are the variants of its one record (`../../page/surfaceVariant.ts`);
 * - the physical extensions are applied under the parameter names the table writes them with.
 */
import type { TableMaterial, TableTextureSlot, Texture } from '../../../../sdk-core/src/index.ts'
import { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts'
import type { AlphaMode } from '../../../../sdk-core/src/contracts/material.ts'
import { COLOUR_MAPS, MATERIAL_COLOURS } from '../../../../sdk-core/src/world/material/material.ts'
import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import type { PageSurface } from '../../page/surface.ts'
import { declareSurface } from '../../page/surfaceRecord.ts'
import type { SurfaceDeclaration } from '../../page/surfaceDeclaration.ts'
import { surfaceVariant, type SurfaceVariant } from '../../page/surfaceVariant.ts'

type Slot = (slot: TableTextureSlot, colour: boolean) => Promise<Texture | null>
type Params = Record<string, unknown>

/** How a surface draws its alpha mode, at open and when a page changes it
 *  (`../../world/api/materialValues.ts`): blended, it composes and writes no depth; masked, it cuts
 *  at `cutoff`; opaque, neither. */
export const alphaModeFields = (mode: AlphaMode, cutoff: number) => ({
  transparent: mode === 'blend',
  depthWrite: mode !== 'blend',
  alphaTest: mode === 'mask' ? cutoff : 0,
})

const isSlot = (value: unknown): value is TableTextureSlot =>
  typeof value === 'object' && value !== null && 'texture' in value

function extensionParams(
  entry: TableMaterial,
  params: Params,
  assign: (name: string, slot: TableTextureSlot) => void,
) {
  for (const [name, value] of Object.entries(entry.extensions)) {
    if (isSlot(value)) assign(name, value)
    else if (name === 'clearcoatNormalScale')
      params[name] = new Vector2(value as number, value as number)
    else if (MATERIAL_COLOURS.has(name)) params[name] = new Color(value as [number, number, number])
    else params[name] = Array.isArray(value) ? [...value] : value
  }
  // A frame rebuilt from the triangle, on geometry without tangents, turns the second clear-coat
  // normal factor the way it turns the first.
  if (entry.kind === 'physical' && entry.derivativeTangents) {
    const scale = (params.clearcoatNormalScale as Vector2 | undefined) ?? new Vector2(1, 1)
    params.clearcoatNormalScale = scale.set(scale.x, -scale.y)
  }
}

/** The table rank each prepared surface was built from: the scene's own material id, which a
 *  page lists and sets by (`../../world/api/materialApi.ts`); a surface built elsewhere has none. */
const tableRanks = new WeakMap<PageSurface, number>()
export const tableRankOf = (surface: PageSurface) => tableRanks.get(surface)

async function build(materials: readonly TableMaterial[], rank: number, slot: Slot) {
  const entry = materials[rank]
  const params: Params = { color: new Color(entry.baseColor), opacity: entry.opacity }
  const pending: Promise<void>[] = []
  // A map that holds a colour (`COLOUR_MAPS`) is read in sRGB.
  const assign = (name: string, from: TableTextureSlot | null) => {
    if (from)
      pending.push(
        slot(from, COLOUR_MAPS.has(name)).then((texture) => {
          if (texture) params[name] = texture
        }),
      )
  }
  assign('map', entry.map)
  if (entry.kind !== 'unlit') {
    params.metalness = entry.metalness
    params.roughness = entry.roughness
    assign('metalnessMap', entry.metalnessMap)
    assign('roughnessMap', entry.roughnessMap)
    assign('normalMap', entry.normalMap)
    params.normalScale = new Vector2(entry.normalScale, entry.normalScaleY)
    assign('aoMap', entry.aoMap)
    params.aoMapIntensity = entry.aoIntensity
    params.emissive = new Color(entry.emissive)
    assign('emissiveMap', entry.emissiveMap)
    extensionParams(entry, params, assign)
  }
  if (entry.kind === 'physical') {
    params.transmission = entry.transmission
    params.ior = entry.ior
    params.thickness = entry.thickness
    params.attenuationDistance = entry.attenuationDistance || Infinity
    params.attenuationColor = new Color(entry.attenuationColor)
  }
  // Which frame the normal factors were written for: an engine pass that reads no tangent turns
  // the second one of a surface written for vertex tangents (`../../page/surfaceRecord.ts`).
  params.forVertexTangents = !entry.derivativeTangents
  if (entry.doubleSided) params.side = 'double'
  Object.assign(
    params,
    alphaModeFields(entry.alphaMode.toLowerCase() as AlphaMode, entry.alphaTest),
  )
  await Promise.all(pending)
  params.family =
    entry.kind === 'unlit' ? 'basic' : entry.kind === 'physical' ? 'physical' : 'standard'
  if (entry.name) params.name = entry.name
  return declareSurface(params as SurfaceDeclaration)
}

/**
 * The surface of each table rank in each variant, built once and shared by every primitive that
 * wears it: a record the engine holds per surface is then held once per surface. A rank's record
 * is built once, its variants written from it (`surfaceVariant`).
 */
export function preparedMaterials(materials: readonly TableMaterial[], slot: Slot) {
  const built = new Map<number, Promise<PageSurface>>()
  const variants = new Map<number, Map<string, PageSurface>>()
  return async (rank: number, variant: SurfaceVariant) => {
    let plain = built.get(rank)
    if (!plain) built.set(rank, (plain = build(materials, rank, slot)))
    let held = variants.get(rank)
    if (!held) variants.set(rank, (held = new Map()))
    const material = surfaceVariant(await plain, held, variant)
    tableRanks.set(material, rank)
    return material
  }
}
