import * as THREE from 'three';
import type { SceneLight, SceneLightStore } from '../sdk-core/index.ts';
import { asHostLibrary } from './hostResources.ts';
import type { HostDrawScene } from './hostGraphNodes.ts';
import { baseCapabilities } from './backendCommon.ts';
import { createUnlitAlbedo } from './exactPagesUnlitAlbedo.ts';
import { createLight, writeLight } from './exactPagesLightWrite.ts';

/** A Three-rendered engine applies the contract lights; only their shadows are missing —
 *  Three would provide them only at the cost of one map per light, six faces for a point light,
 *  outside the frame budget. Both constants say that in the engine's published capabilities. */
export const CONTRACT_LIGHTS_LIGHTING = {
  shadows: false,
  reason: "contract lights with no cast shadow; the 'bounce' view equals the lit view there",
};
const RETIRES = ['bounded GPU eviction', 'contract scene lights with shadow atlas'];
export const CONTRACT_LIGHTS_UNSUPPORTED = baseCapabilities.unsupported
  .filter((item) => !RETIRES.includes(item))
  .concat('contract scene light shadows');

/** Raw albedo by light: diffuse is `irradiance · albedo / π`, so an ambient irradiance of π
 *  yields albedo — `createUnlitAlbedo` keeps every material's response to it that albedo. */
const UNLIT_IRRADIANCE = Math.PI;

/**
 * Ties the contract light store to the lights displayed by a Three-rendered engine.
 *
 * The contract takes over only when the host has used it — a declared light, or a requested
 * view. Until it has, the source-graph lights stay the only ones lighting and the image is
 * the one from before this batch, pixel for pixel. As soon as it has, the source graph
 * disappears: two stacked light sets would be nobody's lighting.
 */
function createContractLights(display: HostDrawScene, store: SceneLightStore | undefined) {
  const scene = asHostLibrary<THREE.Scene>(display);
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const ambient = new THREE.AmbientLight(0xffffff, UNLIT_IRRADIANCE);
  // The environment's irradiance (`sceneEnvironment.ts`): the host's probe reads the same nine
  // coefficients, in the same band order, with the same cosine-lobe factors.
  const probe = new THREE.LightProbe();
  ambient.visible = probe.visible = false;
  group.add(ambient, probe);
  const albedo = createUnlitAlbedo(scene);
  // The light type is kept beside it: setting a point light as a spotlight changes the Three
  // object, and comparing type strings would cost an allocation per light and per pass.
  const lights = new Map<string, { light: THREE.Light; kind: SceneLight['kind'] }>();
  let epoch = -1,
    governs = false;
  const drop = (id: string) => {
    const entry = lights.get(id)!;
    group.remove(entry.light);
    if ('target' in entry.light) group.remove((entry.light as THREE.DirectionalLight).target);
    entry.light.dispose();
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
        if ('target' in entry.light) group.add((entry.light as THREE.DirectionalLight).target);
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
      if ((probe.visible = !!sh)) probe.sh.fromArray(sh as number[]);
      return true;
    },
    /** True when the image comes out in real light: then goes through the display curve (P6). */
    get lit() {
      return governs && !!store && !store.unlit;
    },
  };
}

/**
 * Hooks the contract onto a Three-rendered engine and returns what it takes to hold it:
 * `apply` on every store revision, `lit` every frame. Imported lights are declared before
 * the engine exists, so the first pass happens here, at construction.
 */
export function attachContractLights(
  scene: HostDrawScene,
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
