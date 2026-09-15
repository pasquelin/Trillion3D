import { validateSceneLight, type SceneLight, type SceneLightStore } from '../sdk-core/index.ts';

/** Le produit de cache des lampes, à côté du manifeste qui le voisine. Sa version lui est propre. */
const IMPORTED_LIGHTS_FILE = 'lights.json';
const IMPORTED_LIGHTS_VERSION = 1;

/** Ce que le cache déclare : la liste des lampes du fichier source et le compte de celles refusées. */
type ImportedLightsFile = {
  version?: number;
  lights?: unknown;
  rejected?: Record<string, number>;
};

/**
 * Lit les lampes que le fichier source portait, converties par le compilateur dans le contrat du
 * moteur. La lecture est tolérante par construction : un cache compilé avant ce produit, un fichier
 * absent, une version inconnue ou un corps illisible valent zéro lampe importée — donc exactement
 * le comportement d'avant, vue `unlit` par défaut. Ce n'est jamais une erreur de préparation.
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
    // Une lampe importée passe la validation publiée du contrat, `validateSceneLight`, celle-là
    // même que le magasin applique aux lampes de l'hôte : ce chemin n'en tient aucune copie.
    try {
      lights.push(validateSceneLight(candidate as SceneLight));
    } catch {
      rejected['light-refused-by-contract'] = (rejected['light-refused-by-contract'] ?? 0) + 1;
    }
  }
  return { lights, rejected };
}

/**
 * Les `room` lampes qui portent le plus loin, rendues dans l'ordre du cache : les directionnelles
 * d'abord, puis les plus fortes par intensité maximale de canal. Le tri de JavaScript est stable,
 * si bien que deux lampes de même portée gardent leur rang d'origine.
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
 * Déclare les lampes importées dans le magasin de la session, à l'ouverture et sans que l'hôte ait
 * rien à faire : une scène importée arrive avec ses lumières. L'ombre vient du drapeau que le
 * fichier portait — le runtime plafonne déjà le nombre de cartes remises à jour par image. Le
 * contrat n'accepte que `maxLights` lampes ; au-delà, les moins portantes sont comptées dans
 * `dropped` et publiées par le diagnostic, jamais silencieusement perdues.
 */
export function declareImportedLights(
  store: SceneLightStore,
  imported: readonly SceneLight[],
): { declared: string[]; dropped: number } {
  const keep = withinBudget(imported, Math.max(0, store.settings.maxLights - store.count));
  for (const light of keep) store.add(light);
  return { declared: keep.map((light) => light.id), dropped: imported.length - keep.length };
}
