import { EngineError } from './cacheContracts.ts';
import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  SCENE_LIGHT_BUFFER_FLOATS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  type SceneEnvironment,
  type SceneLight,
  type SceneLightingView,
} from './sceneLightContracts.ts';
import { validateSceneEnvironment, validateSceneLight } from './sceneLightValidate.ts';

/** Champ d'une lampe dans le tampon, en flottants depuis sa base. Quatre `vec4f` par lampe. */
export const LIGHT_FIELD = {
  position: 0,
  range: 3,
  color: 4,
  intensity: 7,
  direction: 8,
  cosCone: 11,
  kind: 12,
  shadowSlice: 13,
  castsShadow: 14,
} as const;
/** Une ponctuelle ne teste aucun cône : sa valeur de cosinus ne peut jamais rejeter une direction. */
const NO_CONE = -2;

export type SceneLightStore = ReturnType<typeof createSceneLightStore>;

/**
 * Les lampes de la scène, à capacité fixe. Le tampon est alloué une fois pour `maxLights` lampes et
 * n'est jamais réalloué ; ajouter, régler ou retirer une lampe n'écrit que ses seize flottants et
 * incrémente sa révision. `revision` par lampe est ce que l'ordonnanceur d'ombres lit pour savoir
 * qu'une lampe a changé : aucune structure n'est reconstruite par image.
 */
export function createSceneLightStore() {
  const packed = new Float32Array(SCENE_LIGHT_BUFFER_FLOATS);
  const header = new Uint32Array(packed.buffer, 0, SCENE_LIGHT_HEADER_FLOATS);
  const ids: string[] = [];
  const indexOf = new Map<string, number>();
  const revision = new Uint32Array(LIGHT_SETTINGS.maxLights);
  let environment: SceneEnvironment | undefined,
    view: SceneLightingView = 'auto',
    epoch = 1;
  const baseOf = (slot: number) => SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
  /** La tranche d'atlas d'une lampe vit dans le tampon lui-même : elle n'est pas tenue deux fois. */
  const sliceOf = (slot: number) => packed[baseOf(slot) + LIGHT_FIELD.shadowSlice];
  const writeSlice = (slot: number, slice: number) => {
    packed[baseOf(slot) + LIGHT_FIELD.shadowSlice] = slice;
  };
  /** Les champs déclarés par l'hôte. La tranche d'ombre n'en est pas un : l'ordonnanceur la pose. */
  const write = (slot: number, light: SceneLight) => {
    const base = baseOf(slot);
    // Une directionnelle n'a ni position ni portée : ses deux champs restent à zéro dans le tampon,
    // et le shader ne les lit jamais — il branche sur le type avant.
    const position = light.position ?? [0, 0, 0];
    packed[base + LIGHT_FIELD.position] = position[0];
    packed[base + LIGHT_FIELD.position + 1] = position[1];
    packed[base + LIGHT_FIELD.position + 2] = position[2];
    packed[base + LIGHT_FIELD.range] = light.range ?? 0;
    packed[base + LIGHT_FIELD.color] = light.color[0];
    packed[base + LIGHT_FIELD.color + 1] = light.color[1];
    packed[base + LIGHT_FIELD.color + 2] = light.color[2];
    packed[base + LIGHT_FIELD.intensity] = light.intensity;
    const direction = light.direction ?? [0, -1, 0];
    packed[base + LIGHT_FIELD.direction] = direction[0];
    packed[base + LIGHT_FIELD.direction + 1] = direction[1];
    packed[base + LIGHT_FIELD.direction + 2] = direction[2];
    packed[base + LIGHT_FIELD.cosCone] =
      light.kind === 'spot' ? Math.cos(light.coneAngle!) : NO_CONE;
    packed[base + LIGHT_FIELD.kind] = LIGHT_KIND[light.kind];
    packed[base + LIGHT_FIELD.castsShadow] = light.castsShadow ? 1 : 0;
  };
  const records = new Map<string, SceneLight>();
  const store = {
    settings: LIGHT_SETTINGS,
    packed,
    revision,
    sliceOf,
    ids,
    get count() {
      return ids.length;
    },
    get epoch() {
      return epoch;
    },
    get environment() {
      return environment;
    },
    /** La vue demandée par l'hôte, telle quelle : `auto` tant qu'il n'a rien demandé. */
    get lightingView(): SceneLightingView {
      return view;
    },
    /**
     * Vrai quand l'image doit sortir en albédo brut, sans aucune lumière. C'est le comportement par
     * défaut tant qu'aucune lampe n'est déclarée : une scène sans source n'a rien à éclairer, et une
     * image noire n'aiderait aucun banc de géométrie. Dès qu'une lampe existe, l'éclairage réel
     * s'impose — sauf si l'hôte a explicitement demandé la vue de diagnostic.
     */
    get unlit() {
      return view === 'unlit' || (view === 'auto' && ids.length === 0);
    },
    setView(next: SceneLightingView) {
      if (view === next) return;
      view = next;
      epoch++;
    },
    light(id: string) {
      return records.get(id);
    },
    slotOf(id: string) {
      return indexOf.get(id) ?? -1;
    },
    add(light: SceneLight) {
      const validated = validateSceneLight(light);
      if (indexOf.has(validated.id))
        throw new EngineError('DUPLICATE_SCENE_LIGHT', `lampe ${validated.id} déjà présente`, {
          id: validated.id,
        });
      if (ids.length >= LIGHT_SETTINGS.maxLights)
        throw new EngineError(
          'SCENE_LIGHT_BUDGET',
          `${ids.length + 1} lampes demandées, ${LIGHT_SETTINGS.maxLights} publiées`,
          { maxLights: LIGHT_SETTINGS.maxLights },
        );
      const slot = ids.length;
      ids.push(validated.id);
      indexOf.set(validated.id, slot);
      records.set(validated.id, validated);
      revision[slot]++;
      write(slot, validated);
      // Un slot neuf est à zéro dans le tampon ; sans tranche, la valeur publiée est −1.
      writeSlice(slot, -1);
      header[0] = ids.length;
      epoch++;
      return slot;
    },
    set(id: string, patch: Partial<Omit<SceneLight, 'id'>>) {
      const slot = indexOf.get(id);
      const current = records.get(id);
      if (slot === undefined || !current)
        throw new EngineError('UNKNOWN_SCENE_LIGHT', `lampe ${id} inconnue`, { id });
      const merged = validateSceneLight({ ...current, ...patch, id });
      records.set(id, merged);
      revision[slot]++;
      write(slot, merged);
      epoch++;
    },
    remove(id: string) {
      const slot = indexOf.get(id);
      if (slot === undefined)
        throw new EngineError('UNKNOWN_SCENE_LIGHT', `lampe ${id} inconnue`, {
          id,
        });
      const last = ids.length - 1;
      if (slot !== last) {
        const movedId = ids[last];
        ids[slot] = movedId;
        indexOf.set(movedId, slot);
        revision[slot] = revision[last] + 1;
        write(slot, records.get(movedId)!);
        writeSlice(slot, sliceOf(last));
      }
      ids.length = last;
      indexOf.delete(id);
      records.delete(id);
      revision[last] = 0;
      packed.fill(
        0,
        SCENE_LIGHT_HEADER_FLOATS + last * SCENE_LIGHT_FLOATS,
        SCENE_LIGHT_HEADER_FLOATS + (last + 1) * SCENE_LIGHT_FLOATS,
      );
      header[0] = ids.length;
      epoch++;
    },
    setEnvironment(next: SceneEnvironment) {
      environment = validateSceneEnvironment(next);
      epoch++;
    },
    /** Note la tranche d'atlas qu'une lampe occupe, sans toucher au reste de ses champs. La révision
     *  du magasin ne monte que si la tranche a réellement changé : sinon rien n'est repoussé au GPU. */
    assignSlice(slot: number, slice: number) {
      if (sliceOf(slot) === slice) return;
      writeSlice(slot, slice);
      epoch++;
    },
    /** Les flottants réellement occupés : l'écriture GPU ne pousse jamais les slots vides. */
    view() {
      return packed.subarray(0, SCENE_LIGHT_HEADER_FLOATS + ids.length * SCENE_LIGHT_FLOATS);
    },
  };
  return store;
}
