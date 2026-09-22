import * as THREE from 'three';
import { LIGHT_SETTINGS, type SceneLight, type SceneLightStore } from '../sdk-core/index.ts';
import { asHostLibrary } from './hostResources.ts';
import type { HostDrawScene } from './hostGraphNodes.ts';
import { baseCapabilities } from './backendCommon.ts';
import { createUnlitAlbedo } from './exactPagesUnlitAlbedo.ts';

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

/**
 * Raw albedo by light: a material yields `irradiance · albedo / π` in diffuse, so an ambient
 * irradiance of π yields albedo — provided nothing takes its response away from that albedo,
 * which `createUnlitAlbedo` handles for the frame, lit-frame materials included.
 */
const UNLIT_IRRADIANCE = Math.PI;
/** Eye distance of a directional: it has no position, only its direction counts. */
const SUN_DISTANCE = 1;

/** Conversion of the contract linear colour, without going through sRGB: that is the working space. */
function applyColor(light: THREE.Light, source: SceneLight) {
  light.color.setRGB(source.color[0], source.color[1], source.color[2]);
  light.intensity = source.intensity;
}

/**
 * Penumbra half-angle that reproduces the contract cone edge. The WebGPU path softens the
 * cone between `cos(half-angle)` and `cos(half-angle) + spotEdgeSoftness`; Three softens
 * between `cos(angle)` and `cos(angle · (1 − penumbra))`. Equating the two cosines gives this
 * penumbra — the same transition, not a neighbouring one.
 */
function spotPenumbra(coneAngle: number) {
  const inner = Math.acos(Math.min(1, Math.cos(coneAngle) + LIGHT_SETTINGS.spotEdgeSoftness));
  return Math.min(1, Math.max(0, 1 - inner / coneAngle));
}

/** A fresh Three light of the requested type, with its target when it has one. */
function createLight(source: SceneLight): THREE.Light {
  if (source.kind === 'point') return new THREE.PointLight();
  if (source.kind === 'spot') return new THREE.SpotLight();
  return new THREE.DirectionalLight();
}

/**
 * Writes a contract light into its Three light. Units are the contract's, with no adjustment
 * factor: `intensity` is a radiometric intensity in W/sr for a point or a spotlight, and Three
 * with `decay = 2` and `distance = range` applies exactly the deferred-lighting shader
 * attenuation — `pow(clamp(1 − (d/range)⁴, 0, 1), 2) / d²`, term for term. A directional
 * carries an irradiance, the same everywhere, and Three does the same.
 *
 * What is not equalised and does not claim to be: the surface model. Three evaluates a
 * Cook-Torrance of its own, the WebGPU path its own; incident irradiance is the same, the
 * image is not. No shadows either — see `shadows: false` in the engine capabilities.
 */
function writeLight(light: THREE.Light, source: SceneLight) {
  applyColor(light, source);
  if (source.kind === 'directional') {
    const direction = source.direction!;
    light.position.set(
      -direction[0] * SUN_DISTANCE,
      -direction[1] * SUN_DISTANCE,
      -direction[2] * SUN_DISTANCE,
    );
    (light as THREE.DirectionalLight).target.position.set(0, 0, 0);
    return;
  }
  const position = source.position!;
  light.position.set(position[0], position[1], position[2]);
  const punctual = light as THREE.PointLight;
  punctual.distance = source.range!;
  punctual.decay = 2;
  if (source.kind !== 'spot') return;
  const spot = light as THREE.SpotLight;
  spot.angle = source.coneAngle!;
  spot.penumbra = spotPenumbra(source.coneAngle!);
  const direction = source.direction!;
  spot.target.position.set(
    position[0] + direction[0],
    position[1] + direction[1],
    position[2] + direction[2],
  );
}

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
  ambient.visible = false;
  group.add(ambient);
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
      return true;
    },
    /** True when the image comes out in real light: composition then goes through ACES (P6). */
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
