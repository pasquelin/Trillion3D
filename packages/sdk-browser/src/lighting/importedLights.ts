import {
  validateSceneLight,
  type SceneLight,
  type SceneLightStore,
} from '../../../sdk-core/src/index.ts';

/** Lights cache product, next to the neighbouring manifest. Its version is its own. */
const IMPORTED_LIGHTS_FILE = 'lights.json';
const IMPORTED_LIGHTS_VERSION = 1;

/** What the cache declares: the source file's light list and the count of those refused. */
type ImportedLightsFile = {
  version?: number;
  lights?: unknown;
  rejected?: Record<string, number>;
};

/**
 * Reads the lights the source file carried, converted by the compiler into the engine contract.
 * The read is tolerant by construction: a cache compiled before this product, a missing file, an
 * unknown version or an unreadable body equal zero imported lights — hence exactly the previous
 * behaviour, `unlit` view by default. This is never a prepare error.
 */
export async function loadImportedLights(
  base: string,
  signal?: AbortSignal,
): Promise<{ lights: SceneLight[]; rejected: Record<string, number> }> {
  const none = { lights: [], rejected: {} };
  let file: ImportedLightsFile;
  try {
    const response = await fetch(new URL(IMPORTED_LIGHTS_FILE, base).href, { signal });
    if (!response.ok) return none;
    file = (await response.json()) as ImportedLightsFile;
  } catch {
    return none;
  }
  if (!file || typeof file !== 'object') return none;
  if (file.version !== IMPORTED_LIGHTS_VERSION || !Array.isArray(file.lights)) return none;
  const lights: SceneLight[] = [];
  const rejected: Record<string, number> = { ...(file.rejected ?? {}) };
  for (const candidate of file.lights) {
    // An imported light goes through the contract's published validation, `validateSceneLight`,
    // the same one the store applies to host lights: this path holds no copy of it.
    try {
      lights.push(validateSceneLight(candidate as SceneLight));
    } catch {
      rejected['light-refused-by-contract'] = (rejected['light-refused-by-contract'] ?? 0) + 1;
    }
  }
  return { lights, rejected };
}

/**
 * The `room` lights that reach farthest, returned in cache order: directionals first, then the
 * strongest by max channel intensity. JavaScript's sort is stable, so two lights of the same
 * reach keep their original rank.
 */
function withinBudget(imported: readonly SceneLight[], room: number): readonly SceneLight[] {
  if (imported.length <= room) return imported;
  const reach = (light: SceneLight) =>
    light.intensity * Math.max(light.color[0], light.color[1], light.color[2]);
  const kept = new Set(
    [...imported]
      .sort(
        (a, b) =>
          Number(b.kind === 'directional') - Number(a.kind === 'directional') ||
          reach(b) - reach(a),
      )
      .slice(0, room),
  );
  return imported.filter((light) => kept.has(light));
}

/**
 * Declares the imported lights in the session store, at open and without the host having to do
 * anything: an imported scene arrives with its lights. Shadow comes from the flag the file
 * carried — the runtime already caps the number of maps refreshed per frame. The contract
 * accepts only `maxLights` lights; beyond that, the least reaching are counted in `dropped` and
 * published by the diagnostic, never silently lost.
 */
export function declareImportedLights(
  store: SceneLightStore,
  imported: readonly SceneLight[],
): { declared: string[]; dropped: number } {
  const keep = withinBudget(imported, Math.max(0, store.settings.maxLights - store.count));
  for (const light of keep) store.add(light);
  return { declared: keep.map((light) => light.id), dropped: imported.length - keep.length };
}
