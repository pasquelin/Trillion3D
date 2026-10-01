import type { SceneFog, SceneLight, SceneLightStore } from '../../../sdk-core/src/index.ts';
import { Light } from '../../../sdk-core/src/world/light/light.ts';
import { aimOf } from '../host/graph/kinds.ts';
import { numbered } from '../host/graph/serial.ts';
import type { Scene } from '../world/core/scene.ts';
import { fogOf } from '../world/core/sceneFog.ts';
import { createUnlitAlbedo } from './unlitAlbedo.ts';
import { createLight, writeLight } from './lightWrite.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { castsShadow } from '../../../sdk-core/src/scene/light-shadow/casters.ts';

/** A WebGL2 engine applies the contract lights; only their shadows are missing — one map per
 *  light, six faces for a point light, would be outside the frame budget. The engine's published
 *  capabilities say so, and a light that asks to cast is named (`ContractShadows`). */
export const CONTRACT_LIGHTS_LIGHTING = {
  shadows: false,
  reason: "contract lights with no cast shadow; the 'bounce' view equals the lit view there",
};

/** Hears the ids of the lit lights that ask to cast — the contract's, else the source graph's —
 *  at each change of them: a WebGL2 engine draws them unshadowed and says so
 *  (`noticeShadowRefusal`), never silently. */
export type ContractShadows = (casting: readonly string[]) => void;

/** Raw albedo by light: diffuse is `irradiance · albedo / π`, so an ambient irradiance of π
 *  yields albedo — `createUnlitAlbedo` keeps every material's response to it that albedo. */
const UNLIT_IRRADIANCE = Math.PI;

/**
 * Ties the contract light store to the lights of the display graph a WebGL2 engine draws.
 *
 * The contract takes over when the host has used it — a declared light, or a requested view —,
 * or when the source graph declares no light either: `auto` with no light anywhere is the unlit
 * view, raw albedo, as on WebGPU (`SceneLightingView`), never a black frame (#1016). Until then
 * the source-graph lights stay the only ones lighting and the image is the one from before this
 * batch, pixel for pixel. As soon as it has, the source graph disappears: two stacked light sets
 * would be nobody's lighting.
 */
function createContractLights(scene: Scene, store: SceneLightStore | undefined) {
  const group = new Group();
  group.visible = false;
  scene.add(group);
  const ambient = numbered(new Light('ambient', { color: [1, 1, 1], intensity: UNLIT_IRRADIANCE }));
  // The environment's irradiance (`packages/sdk-core/src/scene/core/environment.ts`): the probe
  // carries the same nine coefficients, in the same band order, read with the same cosine-lobe
  // factors (`../../webgl/cluster/probe.ts`).
  const probe = numbered(new Light('probe'));
  ambient.visible = probe.visible = false;
  group.add(ambient, probe);
  const albedo = createUnlitAlbedo(scene);
  // The light type is kept beside it: setting a point light as a spotlight changes the light
  // object, and comparing type strings would cost an allocation per light and per pass.
  const lights = new Map<string, { light: Light; kind: SceneLight['kind'] }>();
  let epoch = -1,
    governs = false;
  // The lit lights asking to cast, read from the store's own flag at each of its revisions.
  let casting: readonly string[] = [];
  // The store's fog the scene holds, converted once: a revision that keeps it rewrites nothing.
  let heldFog: SceneFog | undefined;
  const setFog = (fog: SceneFog | undefined) => {
    if (fog !== heldFog) scene.fog = fogOf((heldFog = fog));
  };
  const drop = (id: string) => {
    const entry = lights.get(id)!;
    group.remove(entry.light);
    const target = aimOf(entry.light);
    if (target) group.remove(target);
    lights.delete(id);
  };
  const dropAll = () => {
    for (const id of [...lights.keys()]) drop(id);
  };
  const rebuild = () => {
    const ids = new Set(store!.ids);
    for (const [id, entry] of [...lights])
      if (!ids.has(id) || store!.light(id)!.kind !== entry.kind) drop(id);
    for (const id of store!.ids) {
      const source = store!.light(id)!;
      let entry = lights.get(id);
      if (!entry) {
        entry = { light: createLight(source), kind: source.kind };
        lights.set(id, entry);
        group.add(entry.light);
        const target = aimOf(entry.light);
        if (target) group.add(target);
      }
      writeLight(entry.light, source);
    }
  };
  return {
    /**
     * Returns true when the contract now governs lighting — the caller must then stop
     * refreshing the source-graph lights. Does nothing while the store and `sourceLights` hold.
     * `sourceLights`: the source graph declares a light, which `auto` then leaves lighting.
     */
    refresh(sourceLights: boolean) {
      if (!store) return false;
      const wanted = store.count > 0 || store.lightingView !== 'auto' || !sourceLights;
      if (!wanted) {
        albedo.setEnabled(false);
        if (governs) dropAll();
        governs = false;
        setFog(undefined);
        group.visible = false;
        // Taken back later on an unchanged store (the source's last light gone): rebuilt then.
        epoch = -1;
        return false;
      }
      governs = true;
      group.visible = true;
      if (epoch === store.epoch) return true;
      epoch = store.epoch;
      // `unlit` — requested, or `auto` with no light — shows no light: ambient yields albedo.
      ambient.visible = store.unlit;
      albedo.setEnabled(store.unlit);
      if (store.unlit) dropAll();
      else rebuild();
      // The unlit view draws no light, so no shadow is missing from it.
      casting = store.unlit ? [] : store.ids.filter((_, slot) => castsShadow(store, slot));
      const sh = store.unlit ? undefined : store.environment?.irradiance;
      setFog(store.unlit ? undefined : store.environment?.fog);
      if ((probe.visible = !!sh)) copyCoefficients(probe, sh);
      return true;
    },
    /** True once the contract lights the scene, the source graph then off. */
    get governs() {
      return governs;
    },
    /** The ids of the lit contract lights asking to cast, as at the store's last revision. */
    get casting() {
      return casting;
    },
    /** True when the image comes out in real light: then goes through the display curve (P6). */
    get lit() {
      return governs && !!store && !store.unlit;
    },
  };
}

/** The environment's coefficients written into the probe's own list, in place. */
function copyCoefficients(probe: Light, sh: ArrayLike<number>) {
  const into = (probe.sh ??= []);
  for (let k = 0; k < sh.length; k++) into[k] = sh[k];
}

/**
 * Hooks the contract onto a WebGL2 engine and returns what it takes to hold it:
 * `apply` on every store revision, `lit` every frame; `shadowsRefused` hears the casting lights
 * of the set that lights, at each change of either.
 * Imported lights are declared before the engine exists, so the first pass happens here, at
 * construction.
 */
export function attachContractLights(
  scene: Scene,
  store: SceneLightStore | undefined,
  source: {
    setEnabled(enabled: boolean): void;
    readonly lit: boolean;
    readonly declared: boolean;
    readonly casting: readonly string[];
    castingChanged?: () => void;
  },
  sceneChanged: () => void,
  shadowsRefused?: ContractShadows,
) {
  const contract = createContractLights(scene, store);
  // The casting lights of the set that lights now: the contract's once it governs, else the
  // source graph's. Heard at each change of either, never per frame.
  const refused = () => shadowsRefused?.(contract.governs ? contract.casting : source.casting);
  let declared = source.declared;
  const apply = () => {
    declared = source.declared;
    source.setEnabled(!contract.refresh(declared));
    refused();
    sceneChanged();
  };
  // A source lamp shown, hidden or copied again is named if the source graph lights; a copy that
  // gains its first light or loses its last hands the view over (`refresh`'s `sourceLights`).
  source.castingChanged = () => (source.declared === declared ? refused() : apply());
  apply();
  return {
    apply,
    get lit() {
      return contract.lit || source.lit;
    },
  };
}
