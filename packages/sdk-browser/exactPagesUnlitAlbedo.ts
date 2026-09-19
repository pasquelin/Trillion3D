import * as THREE from 'three';

/**
 * Factors that take a surface's response away from its albedo. Each is a material property —
 * never an object type, never a name — and each is a uniform: setting it to zero recompiles
 * no program, it only zeroes a factor for one frame.
 *
 * - `metalness`: the diffuse response is `albedo · (1 − metalness)`, so a pure metal comes
 *   out black whatever irradiance it received. That is the term that made the view wrong.
 * - `aoMapIntensity`, `lightMapIntensity`: two maps that modulate or add irradiance, and
 *   would therefore write something other than the base colour.
 * - `transmission`: what is seen through replaces the base colour, lighting or not.
 *
 * What remains: base colour, base map, vertex colours — albedo — and the material's
 * emission, a named gap of this view against the WebGPU path (`docs/SDK.md`).
 */
const NEUTRAL = ['metalness', 'aoMapIntensity', 'lightMapIntensity', 'transmission'] as const;
type Factors = Partial<Record<(typeof NEUTRAL)[number], number>>;

/**
 * Raw albedo of the `unlit` view on a Three-rendered engine.
 *
 * A material that responds to light cannot publish its albedo by light alone: an ambient
 * irradiance of π yields `albedo · (1 − metalness)`, exact for a dielectric and zero for a
 * metal. The view therefore zeroes the factors above for the frame, then returns to each
 * material the value it carried: the source graph keeps no trace from frame to frame, and
 * going back to `lit` finds the previous state, property by property.
 *
 * The zeroing happens every frame, in the scene render hooks, not once and for all: pages
 * enter and leave residency between two frames, and a conversion done at the switch would
 * leave out of the view everything that arrives after it.
 */
export function createUnlitAlbedo(scene: THREE.Scene) {
  // Materials actually neutralized of the current frame and the values they carried, in two
  // reused arrays: nothing is allocated per frame, and a material shared by several meshes
  // is kept only once — the second visit finds nothing left to zero.
  const touched: Factors[] = [];
  const saved: (number | undefined)[] = [];
  let count = 0;
  const zero = (material: THREE.Material) => {
    const factors = material as Factors;
    const base = count * NEUTRAL.length;
    let changed = false;
    for (let index = 0; index < NEUTRAL.length; index++) {
      const value = factors[NEUTRAL[index]];
      saved[base + index] = value;
      if (!value) continue;
      factors[NEUTRAL[index]] = 0;
      changed = true;
    }
    if (changed) touched[count++] = factors;
  };
  const neutralise = (object: THREE.Object3D) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    if (Array.isArray(material)) for (const one of material) zero(one);
    else zero(material);
  };
  const before = () => {
    count = 0;
    scene.traverse(neutralise);
  };
  const after = () => {
    while (count > 0) {
      count--;
      const factors = touched[count],
        base = count * NEUTRAL.length;
      for (let index = 0; index < NEUTRAL.length; index++) {
        const value = saved[base + index];
        if (value !== undefined) factors[NEUTRAL[index]] = value;
      }
    }
  };
  let enabled = false,
    priorBefore = scene.onBeforeRender,
    priorAfter = scene.onAfterRender;
  return {
    /** Arms or disarms the view. Disarming first returns to the materials what they carried. */
    setEnabled(value: boolean) {
      if (value === enabled) return;
      enabled = value;
      if (value) {
        priorBefore = scene.onBeforeRender;
        priorAfter = scene.onAfterRender;
        scene.onBeforeRender = before;
        scene.onAfterRender = after;
        return;
      }
      after();
      scene.onBeforeRender = priorBefore;
      scene.onAfterRender = priorAfter;
    },
  };
}
