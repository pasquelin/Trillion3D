import {
  LIGHT_SETTINGS,
  validateSceneLight,
  type SceneLight,
  type SceneLightStore,
} from '../sdk-core/index.ts';

/** Le produit de cache des lampes, à côté du manifeste qui le voisine. Sa version lui est propre. */
export const IMPORTED_LIGHTS_FILE = 'lights.json';
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
  const empty = { lights: [], rejected: {} };
  let parsed: ImportedLightsFile;
  try {
    const response = await fetch(new URL(IMPORTED_LIGHTS_FILE, base).href, { signal });
    if (!response.ok) return empty;
    parsed = (await response.json()) as ImportedLightsFile;
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object') return empty;
  if (parsed.version !== IMPORTED_LIGHTS_VERSION) return empty;
  if (!Array.isArray(parsed.lights)) return empty;
  const lights: SceneLight[] = [];
  const rejected: Record<string, number> = { ...(parsed.rejected ?? {}) };
  const refuse = (why: string) => {
    rejected[why] = (rejected[why] ?? 0) + 1;
  };
  for (const candidate of parsed.lights) {
    try {
      lights.push(validateSceneLight(candidate as SceneLight));
    } catch {
      refuse('light-refused-by-contract');
    }
  }
  return { lights, rejected };
}

/**
 * Déclare les lampes importées dans le magasin de la session, à l'ouverture et sans que l'hôte ait
 * rien à faire : une scène importée arrive avec ses lumières. L'ombre vient du drapeau que le
 * fichier portait — le runtime plafonne déjà le nombre de cartes remises à jour par image.
 *
 * Le contrat n'accepte que `maxLights` lampes. Au-delà, celles qui portent le plus loin sont
 * gardées : les directionnelles d'abord, puis les plus fortes par intensité maximale de canal. Les
 * autres sont comptées et publiées, jamais silencieusement perdues.
 */
export function declareImportedLights(
  store: SceneLightStore,
  imported: readonly SceneLight[],
): { declared: SceneLight[]; dropped: number } {
  const room = LIGHT_SETTINGS.maxLights - store.count;
  let keep = imported;
  if (imported.length > room) {
    const power = (light: SceneLight) =>
      light.intensity * Math.max(light.color[0], light.color[1], light.color[2]);
    keep = [...imported]
      .map((light, order) => ({ light, order }))
      .sort(
        (a, b) =>
          Number(b.light.kind === 'directional') - Number(a.light.kind === 'directional') ||
          power(b.light) - power(a.light) ||
          a.order - b.order,
      )
      .slice(0, Math.max(0, room))
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.light);
  }
  const declared: SceneLight[] = [];
  for (const light of keep) {
    store.add(light);
    declared.push(light);
  }
  return { declared, dropped: imported.length - declared.length };
}
