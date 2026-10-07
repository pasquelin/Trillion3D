/**
 * The cache's own description of the prepared scene (`scene-tables.json`): read once per session,
 * and the only thing the scene the engine draws is built from — no glTF is parsed at runtime
 * (`../world/scene/scene.ts`).
 */
import {
  SCENE_TABLES_FILE,
  assertSceneTables,
  type PreparedSceneTables,
} from '../../../sdk-core/src/scene/core/tableContracts.ts'
import { tablePartition } from '../../../sdk-core/src/scene/core/tablePartition.ts'
import { checked } from '../cluster/checked.ts'
import { unmetered, type ByteMeter } from '../cluster/byteMeter.ts'

/** Where a cache keeps its scene tables: the one address their reader and a load's plan use. */
export const sceneTablesUrl = (base: string) => new URL(SCENE_TABLES_FILE, base).href

/** The tables of a prepared cache, verified, with the bytes read: this read is on the load critical
 *  path of every session, so what it costs is published, not supposed. Of a partition only its root
 *  is read: its pages are read as the view reaches them (#575). Absent or of an unknown version,
 *  the tables are a refusal: the cache format that carries them is the only one this runtime
 *  reads. `meter` counts its bytes as they arrive. */
export async function loadPreparedSceneTables(
  base: string,
  signal?: AbortSignal,
  meter: ByteMeter = unmetered,
) {
  const url = sceneTablesUrl(base)
  const response = meter.read(await checked(url, signal), url)
  const body = await response.arrayBuffer()
  const file = assertSceneTables(JSON.parse(new TextDecoder().decode(body)))
  const partition = file.partition && tablePartition(file.partition)
  return { tables: { ...file, partition }, bytes: body.byteLength }
}

/** The published document a session draws: the one the cache's pages were cut from. */
export const SCENE_FILE = 'source.gltf'

/** The document a session draws, its address, and the binary it reads — `null` when it lays out
 *  no view: the one place the scene build and a load's plan both find that binary. */
export function sceneDocument(tables: PreparedSceneTables, base: string) {
  const document = tables.document
  const documentUrl = new URL(SCENE_FILE, base).href
  const bufferUrl = document.views.length ? new URL(document.buffer, documentUrl).href : null
  return { document, documentUrl, bufferUrl }
}
