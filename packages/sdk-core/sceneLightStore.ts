import { EngineError } from './cacheContracts.ts';
import {
  LIGHT_SETTINGS,
  SCENE_LIGHT_BUFFER_FLOATS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  validateSceneEnvironment,
  validateSceneLight,
  type SceneEnvironment,
  type SceneLight,
  type SceneLightMode,
} from './sceneLightContracts.ts';

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
  const shadowSlice = new Int32Array(LIGHT_SETTINGS.maxLights).fill(-1);
  let environment: SceneEnvironment | undefined,
    epoch = 1;
  const write = (slot: number, light: SceneLight) => {
    const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
    packed[base + LIGHT_FIELD.position] = light.position[0];
    packed[base + LIGHT_FIELD.position + 1] = light.position[1];
    packed[base + LIGHT_FIELD.position + 2] = light.position[2];
    packed[base + LIGHT_FIELD.range] = light.range;
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
    packed[base + LIGHT_FIELD.kind] = light.kind === 'spot' ? 1 : 0;
    packed[base + LIGHT_FIELD.castsShadow] = light.castsShadow ? 1 : 0;
    packed[base + LIGHT_FIELD.shadowSlice] = shadowSlice[slot];
  };
  const records = new Map<string, SceneLight>();
  const store = {
    settings: LIGHT_SETTINGS,
    packed,
    revision,
    shadowSlice,
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
    /** `authored` tant que l'hôte n'a déclaré aucun environnement ; `contract` ensuite (mode nuit). */
    get mode(): SceneLightMode {
      return environment ? 'contract' : 'authored';
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
      shadowSlice[slot] = -1;
      revision[slot]++;
      write(slot, validated);
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
        shadowSlice[slot] = shadowSlice[last];
        revision[slot] = revision[last] + 1;
        write(slot, records.get(movedId)!);
      }
      ids.length = last;
      indexOf.delete(id);
      records.delete(id);
      shadowSlice[last] = -1;
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
      if (shadowSlice[slot] === slice) return;
      shadowSlice[slot] = slice;
      packed[SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS + LIGHT_FIELD.shadowSlice] =
        slice;
      epoch++;
    },
    /** Les flottants réellement occupés : l'écriture GPU ne pousse jamais les slots vides. */
    view() {
      return packed.subarray(0, SCENE_LIGHT_HEADER_FLOATS + ids.length * SCENE_LIGHT_FLOATS);
    },
  };
  return store;
}
