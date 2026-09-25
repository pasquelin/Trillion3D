import type { SceneLight, SceneLightStore } from '../../../sdk-core/src/index.ts';
import { GraphAmbientLight, GraphLight, GraphLightProbe } from '../host/graph/light.ts';
import type { GraphScene } from '../host/graph/scene.ts';
import { Color } from '../../../sdk-core/src/world/math/color.ts';
import { createUnlitAlbedo } from './unlitAlbedo.ts';
import { createLight, writeLight, type ContractLight } from './lightWrite.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';

/** The node a light aims at, carried in the graph beside it: a sun's or a spot's, none for a rectangle. */
const aimOf = (light: ContractLight) => (light instanceof GraphLight ? light.target : undefined);

/** A WebGL2 engine applies the contract lights; only their shadows are missing — one map per
 *  light, six faces for a point light, would be outside the frame budget. The engine's published
 *  capabilities say so. */
export const CONTRACT_LIGHTS_LIGHTING = {
  shadows: false,
  reason: "contract lights with no cast shadow; the 'bounce' view equals the lit view there",
};

/** Raw albedo by light: diffuse is `irradiance · albedo / π`, so an ambient irradiance of π
 *  yields albedo — `createUnlitAlbedo` keeps every material's response to it that albedo. */
const UNLIT_IRRADIANCE = Math.PI;

/**
 * Ties the contract light store to the lights of the display graph a WebGL2 engine draws.
 *
 * The contract takes over only when the host has used it — a declared light, or a requested
 * view. Until it has, the source-graph lights stay the only ones lighting and the image is
 * the one from before this batch, pixel for pixel. As soon as it has, the source graph
 * disappears: two stacked light sets would be nobody's lighting.
 */
function createContractLights(scene: GraphScene, store: SceneLightStore | undefined) {
  const group = new Group();
  group.visible = false;
  scene.add(group);
  const ambient = new GraphAmbientLight(new Color().setRGB(1, 1, 1), UNLIT_IRRADIANCE);
  // The environment's irradiance (`packages/sdk-core/src/scene/core/environment.ts`): the probe
  // carries the same nine coefficients, in the same band order, read with the same cosine-lobe
  // factors (`../../webgl/cluster/probe.ts`).
  const probe = new GraphLightProbe();
  ambient.visible = probe.visible = false;
  group.add(ambient, probe);
  const albedo = createUnlitAlbedo(scene);
  // The light type is kept beside it: setting a point light as a spotlight changes the light
  // object, and comparing type strings would cost an allocation per light and per pass.
  const lights = new Map<string, { light: ContractLight; kind: SceneLight['kind'] }>();
  let epoch = -1,
    governs = false;
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
     * refreshing the source-graph lights. Does nothing as long as the store has not changed.
     */
    refresh() {
      if (!store) return false;
      const wanted = store.count > 0 || store.lightingView !== 'auto';
      if (!wanted) {
        albedo.setEnabled(false);
        if (governs) dropAll();
        governs = false;
        group.visible = false;
        epoch = store.epoch;
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
      const sh = store.unlit ? undefined : store.environment?.irradiance;
      if ((probe.visible = !!sh)) probe.sh.fromArray(sh);
      return true;
    },
    /** True when the image comes out in real light: then goes through the display curve (P6). */
    get lit() {
      return governs && !!store && !store.unlit;
    },
  };
}

/**
 * Hooks the contract onto a WebGL2 engine and returns what it takes to hold it:
 * `apply` on every store revision, `lit` every frame. Imported lights are declared before
 * the engine exists, so the first pass happens here, at construction.
 */
export function attachContractLights(
  scene: GraphScene,
  store: SceneLightStore | undefined,
  source: { setEnabled(enabled: boolean): void; readonly lit: boolean },
  sceneChanged: () => void,
) {
  const contract = createContractLights(scene, store);
  const apply = () => {
    source.setEnabled(!contract.refresh());
    sceneChanged();
  };
  apply();
  return {
    apply,
    get lit() {
      return contract.lit || source.lit;
    },
  };
}
