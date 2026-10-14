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

/** The section's baked meshes, keyed by their compiled mesh number; refused entries are left out. */
export function impostorBakedByMesh(
  section: ImpostorSection | undefined,
): Map<number, ImpostorMesh & { maps: ImpostorMaps; frames: number; frameSide: number }> {
  const byMesh: BakedByMesh = new Map()
  if (section)
    for (const mesh of section.meshes) if (impostorMeshBaked(mesh)) byMesh.set(mesh.mesh, mesh)
  return byMesh
}

/** Baked meshes by mesh number: each entry holds the maps, frames and frame side the card reads. */
type BakedByMesh = ReturnType<typeof impostorBakedByMesh>
/** The same, read by a root's mesh number, which a root no impostor may replace lacks. */
export type BakedLookup = ReadonlyMap<
  number | undefined,
  NonNullable<ReturnType<BakedByMesh['get']>>
>
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

/** One baked mesh as a root reads it. */
export type BakedEntry = NonNullable<ReturnType<BakedLookup['get']>>
