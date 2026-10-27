/**
 * WHAT A WRITE OF A WORLD MATERIAL REPAINTS IN PLACE: the key that tells a value from a field the
 * session lays out, and the writes into the entry and the surfaces built from it
 * (`materials/materials.ts`).
 */
import {
  MATERIAL_BOOKKEEPING,
  type Material,
} from '../../../../sdk-core/src/world/material/material.ts'
import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { alphaModeOf } from '../../../../sdk-core/src/contracts/material.ts'
import { alphaMoves, type AlphaChange } from '../../placement/engineSceneUpdates.ts'
import type { PageSurface } from '../../geometry/pages/surface.ts'
import { RANK_READINGS, repaintHostSurface } from './materials/surface.ts'
import type {
  MaterialEntry,
  MaterialsState,
  Repaint,
  RepaintedEntry,
} from './materials/materials.ts'

/** The parameters a session lays out when it opens, and so the only ones never written in place:
 *  `kind` its family, `transparent`, `blending` and `transmission` its pass, `side`, `depthTest`
 *  and `depthWrite` its pipeline, `vertexColors` which surface its wearers take,
 *  `allowNegativeEmissive` the program of its graph (`compileGraph`), `cloudFog`
 *  the programs of the blended pass (`blend/cloudFogText.ts`), `contactShadows` those of the blended pass too
 *  (`materials/surface/blendLightSource.ts`: `contactShadowsOf`), `translucencyLighting` those of the
 *  blended pass too (`blend/pipelines.ts`: `translucencyVolumeOf`), `translucencyPass` the pass its
 *  items' records name (`blend/items.ts`), and the three `translucent…Shadow` ones
 *  the shadow code of those programs (`blend/pipelines.ts`: `translucentShadowOf`), `sizeAttenuation` a sprite's root
 *  mark (`spriteMark`), and `wireframe`,
 *  `flatShading` and `size` the triangles its wearers draw (`cuts.ts`), and `graph`, whose nodes
 *  and textures the shaders and the atlases are laid out for (the values written to its
 *  parameters are written in place, `writeGraphValues`). Every other field but a texture is a
 *  VALUE — a colour, a factor, a physical extension, a cutoff —, which a page-table row or a host
 *  surface reads again at the next frame (#335, #572); a texture's pictures, sampling and
 *  placement move on their own (#362). */
const LAYOUT = new Set([
  'kind',
  'transparent',
  'blending',
  'transmission',
  'side',
  'depthTest',
  'depthWrite',
  'vertexColors',
  'allowNegativeEmissive',
  'cloudFog',
  'contactShadows',
  'translucencyLighting',
  'translucencyPass',
  'translucentLocalLightShadow',
  'translucentLocalLightShadowQuality',
  'translucentDirectionalLightShadowQuality',
  'sizeAttenuation',
  'wireframe',
  'flatShading',
  'size',
  'graph',
])

/** Whether `material`'s field `name` is a value, written in place: neither bookkeeping, nor
 *  `LAYOUT`, nor a texture. */
const isValue = (material: Material, name: string) =>
  !MATERIAL_BOOKKEEPING.has(name) &&
  !LAYOUT.has(name) &&
  !(material[name] as { isTexture?: boolean } | null)?.isTexture

/** One parameter value as a key: a texture by identity and its three counters — its picture's
 *  `version` left out when `pictures` is false —, a graph by its program (two materials with the
 *  same graph are one entry) and, where `values` holds, the values written to its parameters, a
 *  colour or a vector by its numbers, anything else by its own value. */
function valueKey(value: unknown, pictures = true, values = true): string {
  if (value === null || typeof value !== 'object') return String(value)
  const shaped = value as Partial<Texture> & { isTexture?: boolean }
  const graph = value as Partial<MaterialGraph>
  if (graph.isMaterialGraph)
    return `graph:${graph.signature!()}${values ? `|${graph.valuesSignature!()}` : ''}`
  if (shaped.isTexture) {
    const version = pictures ? shaped.version : ''
    return `texture:${shaped.id}@${version}.${shaped.sampling}.${shaped.placement}`
  }
  if (Array.isArray(value)) return `[${value.map((each) => valueKey(each, pictures)).join(',')}]`
  const numbers = Object.entries(value).filter(([, field]) => typeof field === 'number')
  return `{${numbers.map(([name, field]) => `${name}:${field}`).join(',')}}`
}

/** The material's parameters as one string, by name; `values` false leaves the value fields out,
 *  which is what two materials must share for one to be repainted into the other's entry;
 *  `pictures` false leaves out what its textures' pictures are at. */
export function materialKey(material: Material, values = true, pictures = true) {
  const fields = Object.keys(material)
    .filter((name) => !MATERIAL_BOOKKEEPING.has(name) && (values || !isValue(material, name)))
    .sort()
    .map((name) => `${name}=${valueKey(material[name], pictures, values)}`)
  return fields.join(';')
}

/** Writes `material`'s values into its sole entry, when nothing but values changed: opaque or
 *  blended, a pass reads them from its surface's record, which no row or item copies
 *  (`../../materials/table/materialTable.ts`). */
function repaintValues({ sources }: MaterialsState, material: Material, entry: MaterialEntry) {
  const only = sources.get(entry)
  if (only?.size !== 1 || !only.has(material)) return false
  if (materialKey(material, false) !== materialKey(entry.material, false)) return false
  // Only the fields the material holds: a kind never gains a field it does not declare.
  for (const field of Object.keys(material)) {
    if (!isValue(material, field)) continue
    const value = material[field],
      into = entry.material[field]
    // A colour the entry does not hold yet — a specular written after it was made — is a copy.
    if (value instanceof Color && into instanceof Color) into.copy(value)
    else entry.material[field] = value instanceof Color ? value.clone() : value
  }
  writeGraphValues(entry.material, material)
  return true
}

/** The values written to the parameters of `from`'s graph, written to the graph `into` holds: its
 *  program is the same (`materialKey`), its numbers may not be. */
function writeGraphValues(into: Material, from: Material) {
  const target = into.graph
  if (!target) return
  for (const [name, value] of from.graph?.values ?? [])
    if (target.values.get(name) !== value) target.set(name, value)
}

/** Keeps `material` on its entry under its new key, when only values changed, or only the
 *  pictures of its textures — which the entry's copy shares, so every wearer sees them, blended
 *  or shared: a video's frame, a canvas redrawn (#362). */
export function repaint(
  state: MaterialsState,
  material: Material,
  entry: MaterialEntry,
  key: string,
) {
  const { entries, repainted } = state
  if (entries.has(key)) return false
  const pictures = materialKey(material, true, false) === materialKey(entry.material, true, false)
  const { alphaTest } = entry.material,
    from = alphaModeOf(entry.material)
  if (!pictures && !repaintValues(state, material, entry)) return false
  entries.delete(entry.key)
  entries.set((entry.key = key), entry)
  const before = repainted.get(entry),
    done: Repaint = { values: !pictures || !!before?.values }
  const to = alphaModeOf(entry.material)
  // Between opaque and masked, or a cutout's cutoff: what its shadow reads (`AlphaChange`).
  if (before?.alpha || alphaMoves(from, to, entry.material.alphaTest !== alphaTest))
    done.alpha = { from: before?.alpha?.from ?? from, to }
  repainted.set(entry, done)
  return true
}

/** How a session reads repainted surfaces again (`EngineSceneUpdates.refreshMaterials`). */
export type Refresh = (values: boolean, alpha?: AlphaChange) => boolean

/** Declares the surfaces of the entries whose values were written again, then has `refresh` read
 *  every repainted entry's surfaces again (`createWorldMaterials.repaint`). */
export function repaintSurfaces(painted: readonly RepaintedEntry[], refresh?: Refresh) {
  let written = false,
    values = false
  const moved = new Map<string, AlphaChange & { surfaces: PageSurface[] }>()
  for (const { entry, alpha, values: wrote } of painted) {
    const worn: PageSurface[] = []
    entry.surfaces.forEach((plain, rank) => {
      if (!plain) return
      for (const surface of [plain, ...(entry.variants[rank]?.values() ?? [])]) {
        // Pictures alone: the surface holds the texture records themselves, which journal their
        // own writes; declaring it again would journal a surface whose values did not move.
        if (wrote) repaintHostSurface(surface, entry.material, RANK_READINGS[rank])
        worn.push(surface)
      }
    })
    if (!worn.length) continue
    written = true
    values ||= wrote
    if (!alpha) continue
    const way = `${alpha.from}>${alpha.to}`
    const change = moved.get(way)
    if (change) change.surfaces.push(...worn)
    else moved.set(way, { ...alpha, surfaces: worn })
  }
  if (!refresh || !written) return true
  const [first, ...others] = moved.values()
  return refresh(values, first) && others.every((alpha) => refresh(false, alpha))
}
