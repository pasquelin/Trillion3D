import { importedLightsUrl } from '../../lighting/importedLights.ts';
import { worldRootsPlan } from '../../scene/worldRoots.ts';
import { sceneTablesUrl } from '../../scene/tables.ts';

/** The document a world's model draws. */
export const SCENE_FILE = 'source.gltf';

/**
 * The files a model load reads once its manifest is, at the length the manifest declares each,
 * addressed as their readers address them: the scene tables and the lights. The manifest is read
 * before any plan; an image is read only when a surface samples it, and the scene's binary only
 * when a path reads host vertices (`Geometry.loadVertices`), so neither is planned.
 */
export function plannedFiles(
  declared: ReadonlyMap<string, number>,
  base: string,
  manifest: object,
) {
  const read = [sceneTablesUrl(base), importedLightsUrl(base)];
  const files = read.flatMap((url) => (declared.has(url) ? [[url, declared.get(url)!]] : []));
  return new Map([...files, ...worldRootsPlan(declared, base, manifest)] as [string, number][]);
}
