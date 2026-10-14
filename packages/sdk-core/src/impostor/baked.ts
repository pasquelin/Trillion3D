/**
 * THE SECTION'S BAKED MESHES, by compiled mesh number (`Primitive.mesh`, the number the compiler
 * keys its `impostors` entries by): what a root's switch and card read, built once per section.
 */
import {
  impostorMeshBaked,
  type ImpostorMaps,
  type ImpostorMesh,
  type ImpostorSection,
} from '../contracts/impostor.ts'

/** One baked mesh as a root reads it: the maps, frames and frame side the card reads. */
export type BakedEntry = ImpostorMesh & { maps: ImpostorMaps; frames: number; frameSide: number }
/** Baked meshes read by a root's mesh number, which a root no impostor may replace lacks. */
export type BakedLookup = ReadonlyMap<number | undefined, BakedEntry>

/** The section's baked meshes, keyed by their compiled mesh number; refused entries are left out. */
export function impostorBakedByMesh(section: ImpostorSection | undefined) {
  const byMesh = new Map<number, BakedEntry>()
  if (section)
    for (const mesh of section.meshes) if (impostorMeshBaked(mesh)) byMesh.set(mesh.mesh, mesh)
  return byMesh
}

const EMPTY_MESHES: BakedLookup = new Map()
/** The section's baked meshes, built once per section: the watch reads them every update, the map
 *  is not made again. */
const bakedBySection = new WeakMap<ImpostorSection, BakedLookup>()
export function bakedLookup(section: ImpostorSection | undefined): BakedLookup {
  if (!section) return EMPTY_MESHES
  let byMesh = bakedBySection.get(section)
  if (!byMesh) bakedBySection.set(section, (byMesh = impostorBakedByMesh(section)))
  return byMesh
}
