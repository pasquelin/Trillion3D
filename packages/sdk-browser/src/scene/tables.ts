/**
 * The cache's own description of the prepared scene (`scene-tables.json`): read once per session,
 * and the only thing the scene the engine draws is built from — no glTF is parsed at runtime
 * (`../world/scene/scene.ts`).
 */
import {
  EngineError,
  SCENE_TABLES_FILE,
  assertSceneTables,
  type PreparedSceneTables,
} from '../../../sdk-core/src/index.ts';
import { checked } from '../cluster/pages.ts';

/** The tables of a prepared cache, with the size of the product read: this read is on the load
 *  critical path of every session, so what it costs is published, not supposed. Absent or of an
 *  unknown version, the tables are a refusal: the cache format that carries them is the only one
 *  this runtime reads. */
export async function loadPreparedSceneTables(base: string, signal?: AbortSignal) {
  const response = await checked(new URL(SCENE_TABLES_FILE, base).href, signal);
  const body = await response.arrayBuffer();
  const tables = assertSceneTables(JSON.parse(new TextDecoder().decode(body)));
  return { tables, bytes: body.byteLength };
}

/** The geometry layout of the document a session draws — `source.gltf`, or the autonomous scene —
 *  or a named refusal: a cache that lays out another document cannot be drawn half way. */
export function tableDocument(tables: PreparedSceneTables, sceneFile: string) {
  const document = tables.documents[sceneFile];
  if (!document)
    throw new EngineError('PREPARED_SCENE_MISMATCH', `the scene tables lay out no ${sceneFile}`, {
      sceneFile,
      documents: Object.keys(tables.documents),
    });
  return document;
}
