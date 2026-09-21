// Contract lights placed in the Three witness, page side.
//
// This module is SERVED to the page (mount `/mesure/`) and imported by its URL: `measureView` is
// serialised by Playwright and cannot call any module function, but a URL `import()` remains
// open to it. That is the only reason for the split.
//
// The harness is a host like any other. Three adapters do not read the `SceneLight` store:
// they copy lights from the source graph, and nothing else. The host therefore itself places,
// in Three, the lights the store declares — those of the imported file as those of the
// bench — through the public `sceneLighting` option of `createExplorer`. No light is written
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
import * as THREE from 'three';

/** Physical inverse-square of the contract: `directIncidence` knows no other falloff. */
const DECAY = 2;

/**
 * The Three penumbra that reproduces the contract's cone edge. The engine softens the cone
 * with `smoothstep(cos θ, cos θ + douceur, cos α)`; Three with `smoothstep(cos θ, cos(θ(1 − p)), cos α)`.
 * The two edges therefore coincide for `p = 1 − acos(cos θ + douceur) / θ`, clamped to [0, 1].
 */
function penombre(coneAngle, douceur) {
  const interieur = Math.acos(Math.min(1, Math.cos(coneAngle) + douceur));
  return Math.min(1, Math.max(0, 1 - interieur / Math.max(coneAngle, 1e-6)));
}

/** The Three light of the declared type. Three types in the contract, three here, and nothing else. */
export function creer(light) {
  if (light.kind === 'directional') return new THREE.DirectionalLight();
  if (light.kind === 'spot') return new THREE.SpotLight();
  return new THREE.PointLight();
}

/**
 * Contract values applied to the Three light, in Three units: linear colour, radiometric
 * intensity with no factor, `distance` = range and `decay` = 2, which gives exactly the
 * engine's windowed attenuation. A directional has neither position nor range: only the
 * direction counts, which Three reads as `position − target`, hence the opposite of
 * propagation.
 */
export function appliquer(objet, light, douceur) {
  objet.color.setRGB(light.color[0], light.color[1], light.color[2], THREE.LinearSRGBColorSpace);
  objet.intensity = light.intensity;
  objet.castShadow = false;
  if (light.kind === 'directional') {
    objet.position.set(-light.direction[0], -light.direction[1], -light.direction[2]);
    objet.target.position.set(0, 0, 0);
    return;
  }
  objet.position.fromArray(light.position);
  objet.distance = light.range;
  objet.decay = DECAY;
  if (light.kind !== 'spot') return;
  objet.angle = light.coneAngle;
  objet.penumbra = penombre(light.coneAngle, douceur);
  objet.target.position.set(
    light.position[0] + light.direction[0] * light.range,
    light.position[1] + light.direction[1] * light.range,
    light.position[2] + light.direction[2] * light.range,
  );
}

/** Summary published in the reading: what the witness received, never what one assumes it received. */
const resume = (lights) => ({
  nombre: lights.length,
  ponctuelles: lights.filter((light) => light.kind === 'point').length,
  projecteurs: lights.filter((light) => light.kind === 'spot').length,
  directionnelles: lights.filter((light) => light.kind === 'directional').length,
  ids: lights.map((light) => light.id),
  ombres: false,
});

/**
 * The Three light group the host passes as `sceneLighting`, and its store tracking.
 *
 * `suivre` rereads the store and brings the group back in agreement: it recreates objects
 * only if the set of lights has changed — otherwise it only writes their values, which the
 * Three adapter already copies each frame. A dist older than the contract has no `lights()`:
 * tracking then returns `null`, never an invented count.
 */
export function creerEclairageTemoin() {
  const groupe = new THREE.Group();
  const poses = new Map();
  let signature = null;
  return {
    groupe,
    suivre(explorer) {
      if (typeof explorer.lights !== 'function') return null;
      const lights = explorer.lights();
      const douceur = explorer.lightSettings ? explorer.lightSettings.spotEdgeSoftness : 0;
      const clef = lights.map((light) => `${light.id}:${light.kind}`).join('|');
      const change = clef !== signature;
      if (change) {
        for (const objet of poses.values()) groupe.remove(objet);
        poses.clear();
        for (const light of lights) {
          const objet = creer(light);
          poses.set(light.id, objet);
          groupe.add(objet);
        }
        signature = clef;
      }
      for (const light of lights) appliquer(poses.get(light.id), light, douceur);
      // Only a set change asks for a refresh: the adapter copies values on its own.
      if (change) for (const backend of explorer.backends) backend.refreshSceneLighting?.();
      return resume(lights);
    },
  };
}
