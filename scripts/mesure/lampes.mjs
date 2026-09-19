// Benchmark lights placed by a generic rule: no scene is named here.
//
// The rule: a regular grid within the horizontal footprint of the model, at a fixed height above
// its floor, each light bearing a range derived from the cell size. It applies to any imported model;
// the benchmark knows nothing of the measurement set provided to it.

import { plancherDuModele } from './poses.mjs';

/** Benchmark point light intensity fallback: value from previous iterations. */
const DEFAULT_INTENSITY = 40;

/**
 * `count` point lights on a grid within the model's footprint. `shadows` indicates if they
 * project a shadow, `intensity` specifies their emission. Returns the list passed as-is
 * by the host to `addLight`, plus the cell size: light movement is expressed as a fraction of cell size,
 * remaining within its own range.
 *
 * Intensity is a benchmark option and not a scene value: on a model whose grid spans tens of meters,
 * indirect lighting of a street-level point light drops below the 8-bit capture quantum,
 * leaving oracle comparison with nothing to measure. Raising it names no scene — it is the same
 * number for any model, chosen by the operator.
 */
function gridLights(bounds, count, shadows, intensity) {
  if (count <= 0) return { lights: [], cell: 0 };
  const sx = Math.max(1e-3, bounds.max.x - bounds.min.x),
    sy = Math.max(0, bounds.max.y - bounds.min.y),
    sz = Math.max(1e-3, bounds.max.z - bounds.min.z);
  const columns = Math.max(1, Math.round(Math.sqrt((count * sx) / sz))),
    rows = Math.ceil(count / columns);
  const stepX = sx / columns,
    stepZ = sz / rows;
  const cell = Math.hypot(stepX, stepZ);
  // Streetlight height: a fraction of the model's height, never less than two meters.
  const height = plancherDuModele(bounds) + Math.max(2, sy * 0.04);
  const lights = [];
  for (let i = 0; i < count; i++) {
    const column = i % columns,
      row = Math.floor(i / columns);
    lights.push({
      id: `banc-lampe-${i}`,
      kind: 'point',
      position: [bounds.min.x + (column + 0.5) * stepX, height, bounds.min.z + (row + 0.5) * stepZ],
      color: [1, 0.96, 0.88],
      intensity,
      // Range covers the cell and a bit more: ranges overlap like in a street.
      range: cell * 0.75,
      castsShadow: shadows,
    });
  }
  return { lights, cell };
}

/**
 * Benchmark sun: a generic directional light, identical for any model. Its direction points
 * northeast at approximately 40° above the horizon — an arbitrary afternoon, chosen once and never
 * per scene —, its color is neutral, and it projects a shadow. No value here depends on the measurement set.
 */
const SUN = {
  id: 'banc-soleil',
  kind: 'directional',
  direction: [-0.5, -0.64, -0.58],
  color: [1, 0.97, 0.92],
  intensity: 3,
  castsShadow: true,
};

/**
 * Light movement as a fraction of cell size: a small circle traveled in `period` frames.
 * The light stays inside its cell, so its shadow map continuously sees the same objects — what is
 * measured is the update cost, not that of changing occluders.
 */
function movingLightPlan(lights, cell) {
  if (!lights.length) return null;
  return { id: lights[0].id, origin: lights[0].position.slice(), radius: cell * 0.2, period: 60 };
}

/**
 * Lights for a run, or `null` when the benchmark requests none: point grid, sun if requested, and
 * the motion plan of the first point light. Without any lights, the engine renders its unlit view:
 * this is default engine behavior, not a benchmark option.
 */
export function benchLights(bounds, settings) {
  if (!settings.lights && !settings.sun) return null;
  const intensity = settings.lightIntensity ?? DEFAULT_INTENSITY;
  const { lights, cell } = gridLights(bounds, settings.lights, settings.lightShadows, intensity);
  const moving = settings.movingLight ? movingLightPlan(lights, cell) : null;
  const all = settings.sun ? [{ ...SUN, castsShadow: settings.lightShadows }, ...lights] : lights;
  return {
    lights: all,
    moving,
    resume: {
      nombre: all.length,
      ponctuelles: lights.length,
      soleil: settings.sun,
      ombres: settings.lightShadows,
      maille: cell,
      intensite: intensity,
      mobile: !!moving,
    },
  };
}
