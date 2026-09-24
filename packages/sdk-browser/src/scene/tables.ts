/**
 * The cache's own description of the prepared scene (`scene-tables.json`): read once per session,
 * and the only thing the scene the engine draws is built from — no glTF is parsed at runtime
 * (`../world/scene/scene.ts`).
 */
import { EngineError } from '../../../sdk-core/src/index.ts';
import {
  SCENE_TABLES_FILE,
  assertSceneTables,
  type PreparedSceneTables,
} from '../../../sdk-core/src/scene/core/tableContracts.ts';
import { checked } from '../cluster/pages.ts';
import { unmetered, type ByteMeter } from '../cluster/byteMeter.ts';

/** The tables of a prepared cache, with the size of the product read: this read is on the load
 *  critical path of every session, so what it costs is published, not supposed. Absent or of an
 *  unknown version, the tables are a refusal: the cache format that carries them is the only one
 *  this runtime reads. `meter` counts its bytes as they arrive. */
/** Where a cache keeps its scene tables: the one address their reader and a load's plan use. */
export const sceneTablesUrl = (base: string) => new URL(SCENE_TABLES_FILE, base).href;

export async function loadPreparedSceneTables(
  base: string,
  signal?: AbortSignal,
  meter: ByteMeter = unmetered,
) {
  const url = sceneTablesUrl(base);
  const response = meter.read(await checked(url, signal), url);
  const body = await response.arrayBuffer();
  const tables = assertSceneTables(JSON.parse(new TextDecoder().decode(body)));
  return { tables, bytes: body.byteLength };
}

/** The geometry layout of the document a session draws — `source.gltf`, or the autonomous scene —
 *  or a named refusal: a cache that lays out another document cannot be drawn half way. */
function tableDocument(tables: PreparedSceneTables, sceneFile: string) {
  const document = tables.documents[sceneFile];
  if (!document)
    throw new EngineError('PREPARED_SCENE_MISMATCH', `the scene tables lay out no ${sceneFile}`, {
      sceneFile,
      documents: Object.keys(tables.documents),
    });
  return document;
}

/** The document a session draws, its address, and the binary it reads — `null` when it lays out
 *  no view: the one place the scene build and a load's plan both find that binary. */
export function sceneDocument(tables: PreparedSceneTables, sceneFile: string, base: string) {
  const document = tableDocument(tables, sceneFile);
  const documentUrl = new URL(sceneFile, base).href;
  const bufferUrl = document.views.length ? new URL(document.buffer, documentUrl).href : null;
  return { document, documentUrl, bufferUrl };
}
