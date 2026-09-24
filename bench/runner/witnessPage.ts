// Contract lights placed in the Three witness, page side.
//
// This module is SERVED to the page (mount `/runner/`) and imported by its URL: `measureView` is
// serialised by Playwright and cannot call any module function, but a URL `import()` remains
// open to it. That is the only reason for the split.
//
// The harness is a host like any other. Three adapters do not read the `SceneLight` store:
// they copy lights from the source graph, and nothing else. The host therefore itself places,
// as lights of the engine's graph the witness copies, the lights the store declares — those of the imported file as those of the
// bench — through the public `sceneLighting` option of `openMeasuredWorld`. No light is written
// here: everything comes from `explorer.lights()`, hence from the compiled cache and the
// contract, never from a named scene or a position placed by hand.
//
// Both engines then receive the same lighting, and their per-pixel delta finally measures
// materials and rendering, no longer the lighting convention.
//
// What the witness does not render, named rather than guessed: no cast shadows. The SDK's
// Three renderer does not enable its shadow maps, and a light that asked for them would
// compile a shader that reads a missing map. A fidelity campaign therefore runs `--ombres
// off` on both sides, otherwise the measured delta first carries the shadows only the
// engine draws.
import type { MeasuredWorld } from '../witnesses/measurement.ts';
import type { GraphGroup } from '../../packages/sdk-browser/src/host/graph/mesh.ts';
import type { GraphLight } from '../../packages/sdk-browser/src/host/graph/light.ts';
import type { SceneLight } from '../../packages/sdk-core/src/scene/light/contracts.ts';

/** Physical inverse-square of the contract: `directIncidence` knows no other falloff. */
const DECAY = 2;

/**
 * The Three penumbra that reproduces the contract's cone edge. The engine softens the cone
 * with `smoothstep(cos θ, cos θ + douceur, cos α)`; Three with `smoothstep(cos θ, cos(θ(1 − p)), cos α)`.
 * The two edges therefore coincide for `p = 1 − acos(cos θ + douceur) / θ`, clamped to [0, 1].
 */
function penombre(coneAngle: number, douceur: number) {
  const interieur = Math.acos(Math.min(1, Math.cos(coneAngle) + douceur));
  return Math.min(1, Math.max(0, 1 - interieur / Math.max(coneAngle, 1e-6)));
}

/** The graph classes the witness entry exports (`../witnesses/measurement.ts`): this module is
 *  served alone to the page, so it builds with the ones the page's dist hands it. */
export type WitnessGraph = { GraphGroup: typeof GraphGroup; GraphLight: typeof GraphLight };

/** The light of the declared kind. Three kinds in the contract, three here, and nothing else. */
export function creer(graph: WitnessGraph, light: SceneLight): GraphLight {
  return new graph.GraphLight(
    light.kind === 'directional' ? 'directional' : light.kind === 'spot' ? 'spot' : 'point',
  );
}

/**
 * Contract values applied to the Three light, in Three units: linear colour, radiometric
 * intensity with no factor, `distance` = range and `decay` = 2, which gives exactly the
 * engine's windowed attenuation. A directional has neither position nor range: only the
 * direction counts, which Three reads as `position − target`, hence the opposite of
 * propagation.
 */
/** A light as `appliquer` writes it: the graph's, or the bare witness's (`threeBareScene.ts`). */
export type Lampe = {
  readonly color: { setRGB(r: number, g: number, b: number): unknown };
  intensity: number;
  castShadow: boolean;
  readonly position: {
    set(x: number, y: number, z: number): unknown;
    fromArray(a: number[]): unknown;
  };
  readonly target?: { readonly position: { set(x: number, y: number, z: number): unknown } };
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
};

export function appliquer(objet: Lampe, light: SceneLight, douceur: number) {
  objet.color.setRGB(light.color[0], light.color[1], light.color[2]);
  objet.intensity = light.intensity;
  objet.castShadow = false;
  if (light.kind === 'directional') {
    const direction = light.direction ?? [0, -1, 0];
    objet.position.set(-direction[0], -direction[1], -direction[2]);
    objet.target!.position.set(0, 0, 0);
    return;
  }
  const position = light.position ?? [0, 0, 0];
  objet.position.fromArray(position);
  objet.distance = light.range ?? 0;
  objet.decay = DECAY;
  if (light.kind !== 'spot') return;
  const spot = objet;
  const direction = light.direction ?? [0, -1, 0];
  const range = light.range ?? 0;
  spot.angle = light.coneAngle ?? 0;
  spot.penumbra = penombre(light.coneAngle ?? 0, douceur);
  spot.target!.position.set(
    position[0] + direction[0] * range,
    position[1] + direction[1] * range,
    position[2] + direction[2] * range,
  );
}

/** Summary published in the reading: what the witness received, never what one assumes it received. */
const resume = (lights: SceneLight[]) => ({
  nombre: lights.length,
  ponctuelles: lights.filter((light) => light.kind === 'point').length,
  projecteurs: lights.filter((light) => light.kind === 'spot').length,
  directionnelles: lights.filter((light) => light.kind === 'directional').length,
  ids: lights.map((light) => light.id),
  ombres: false,
});

/**
 * The light group of the engine's graph the host passes as `sceneLighting`, and its store
 * tracking.
 *
 * `suivre` rereads the store and brings the group back in agreement: it recreates objects
 * only if the set of lights has changed — otherwise it only writes their values, which the
 * Three adapter already copies each frame. A dist older than the contract has no `lights()`:
 * tracking then returns `null`, never an invented count.
 */
export function creerEclairageTemoin(graph: WitnessGraph) {
  const groupe = new graph.GraphGroup();
  const poses = new Map<string, GraphLight>();
  let signature: string | null = null;
  return {
    groupe,
    suivre(explorer: MeasuredWorld) {
      if (typeof explorer.lights !== 'function') return null;
      const lights = explorer.lights();
      const douceur = explorer.lightSettings ? explorer.lightSettings.spotEdgeSoftness : 0;
      const clef = lights.map((light) => `${light.id}:${light.kind}`).join('|');
      const change = clef !== signature;
      if (change) {
        for (const objet of poses.values()) groupe.remove(objet);
        poses.clear();
        for (const light of lights) {
          const objet = creer(graph, light);
          poses.set(light.id, objet);
          groupe.add(objet);
        }
        signature = clef;
      }
      for (const light of lights) {
        const objet = poses.get(light.id);
        if (objet) appliquer(objet, light, douceur);
      }
      // Only a set change asks for a refresh: the adapter copies values on its own.
      if (change) for (const backend of explorer.backends) backend.refreshSceneLighting?.();
      return resume(lights);
    },
  };
}
