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
import { sameSceneEnvironment, sameSceneLight } from './sceneLightEqual.ts';
import { validateSceneEnvironment, validateSceneLight } from './sceneLightValidate.ts';

/** Field of a light in the buffer, in floats from its base. Four `vec4f` per light. */
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
/** A point tests no cone: its cosine value can never reject a direction. */
const NO_CONE = -2;

export type SceneLightStore = ReturnType<typeof createSceneLightStore>;

/**
 * Scene lights, at fixed capacity. The buffer is allocated once for `maxLights` lights and
 * is never reallocated; adding, setting or removing a light only writes its sixteen floats and
 * increments its revision. Per-light `revision` is what the shadow scheduler reads to know
 * that a light has changed: no structure is rebuilt per frame.
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
  /** A light's atlas slice lives in the buffer itself: it is not held twice. */
  const sliceOf = (slot: number) => packed[baseOf(slot) + LIGHT_FIELD.shadowSlice];
  const writeSlice = (slot: number, slice: number) => {
    packed[baseOf(slot) + LIGHT_FIELD.shadowSlice] = slice;
  };
  const writeVector = (base: number, field: number, value: readonly number[]) => {
    packed[base + field] = value[0];
    packed[base + field + 1] = value[1];
    packed[base + field + 2] = value[2];
  };
  /** Fields declared by the host. The shadow slice is not one: the scheduler sets it. */
  const write = (slot: number, light: SceneLight) => {
    const base = baseOf(slot);
    // A directional has neither position nor range: its two fields stay zero in the buffer,
    // and the shader never reads them — it branches on the kind first.
    writeVector(base, LIGHT_FIELD.position, light.position ?? [0, 0, 0]);
    packed[base + LIGHT_FIELD.range] = light.range ?? 0;
    writeVector(base, LIGHT_FIELD.color, light.color);
    packed[base + LIGHT_FIELD.intensity] = light.intensity;
    writeVector(base, LIGHT_FIELD.direction, light.direction ?? [0, -1, 0]);
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
    /** View requested by the host, as-is: `auto` as long as it has asked for nothing. */
    get lightingView(): SceneLightingView {
      return view;
    },
    /**
     * True when the image must come out as raw albedo, with no light. This is the default
     * behaviour as long as no light is declared: a scene without a source has nothing to light, and a
     * black image would help no geometry bench. As soon as a light exists, real lighting
     * takes over — unless the host has explicitly asked for the diagnostic view.
     */
    get unlit() {
      return view === 'unlit' || (view === 'auto' && ids.length === 0);
    },
    setView(next: SceneLightingView) {
      if (view === next) return;
      view = next;
      epoch++;
    },
    /** The held record, the store's own: engines read it on the frame path and copy nothing.
     *  Not for the host — the public API hands out `cloneSceneLight` copies. */
    light(id: string) {
      return records.get(id);
    },
    slotOf(id: string) {
      return indexOf.get(id) ?? -1;
    },
    add(light: SceneLight) {
      const validated = validateSceneLight(light);
      if (indexOf.has(validated.id))
        throw new EngineError('DUPLICATE_SCENE_LIGHT', `light ${validated.id} already present`, {
          id: validated.id,
        });
      if (ids.length >= LIGHT_SETTINGS.maxLights)
        throw new EngineError(
          'SCENE_LIGHT_BUDGET',
          `${ids.length + 1} lights requested, ${LIGHT_SETTINGS.maxLights} published`,
          { maxLights: LIGHT_SETTINGS.maxLights },
        );
      const slot = ids.length;
      ids.push(validated.id);
      indexOf.set(validated.id, slot);
      records.set(validated.id, validated);
      revision[slot]++;
      write(slot, validated);
      // A new slot is zero in the buffer; without a slice, the published value is −1.
      writeSlice(slot, -1);
      header[0] = ids.length;
      epoch++;
      return slot;
    },
    set(id: string, patch: Partial<Omit<SceneLight, 'id'>>) {
      const slot = indexOf.get(id);
      const current = records.get(id);
      if (slot === undefined || !current)
        throw new EngineError('UNKNOWN_SCENE_LIGHT', `unknown light ${id}`, { id });
      const merged = validateSceneLight({ ...current, ...patch, id });
      // A light reset identically is not a change: neither its revision nor the epoch
      // move, so the scheduler stales no shadow page and the held frame stays.
      if (sameSceneLight(current, merged)) return;
      records.set(id, merged);
      revision[slot]++;
      write(slot, merged);
      epoch++;
    },
    remove(id: string) {
      const slot = indexOf.get(id);
      if (slot === undefined)
        throw new EngineError('UNKNOWN_SCENE_LIGHT', `unknown light ${id}`, {
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
      const validated = validateSceneEnvironment(next);
      // Same rule as `set`: an exposure reset as-is does not stale the frame.
      if (environment && sameSceneEnvironment(environment, validated)) return;
      environment = validated;
      epoch++;
    },
    /** Records the atlas slice a light occupies, without touching the rest of its fields. The store
     *  revision only rises if the slice actually changed: otherwise nothing is pushed to the GPU. */
    assignSlice(slot: number, slice: number) {
      if (sliceOf(slot) === slice) return;
      writeSlice(slot, slice);
      epoch++;
    },
    /** Floats actually occupied: GPU write never pushes empty slots. */
    view() {
      return packed.subarray(0, SCENE_LIGHT_HEADER_FLOATS + ids.length * SCENE_LIGHT_FLOATS);
    },
  };
  return store;
}
