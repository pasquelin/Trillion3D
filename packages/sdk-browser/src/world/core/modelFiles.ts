import { importedLightsUrl } from '../../lighting/importedLights.ts'
import { sceneTablesUrl } from '../../scene/tables.ts'

/**
 * The files a model load reads once its manifest is, at the length the manifest declares each,
 * addressed as their readers address them: the scene tables and the lights. The manifest is read
 * before any plan; the world roots are read through the model's page queue, an image only when a
 * surface samples it, and the scene's binary only when a path reads host vertices
 * (`Geometry.loadVertices`), so none of them is planned.
 */
export function plannedFiles(declared: ReadonlyMap<string, number>, base: string) {
  const read = [sceneTablesUrl(base), importedLightsUrl(base)].filter((url) => declared.has(url))
  return new Map(read.map((url) => [url, declared.get(url)!] as const))
}
