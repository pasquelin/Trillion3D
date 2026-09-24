/**
 * The hillslope processes of the erosion (#332). Thermal erosion after Musgrave, Kolb & Mace,
 * "The Synthesis and Rendering of Eroded Fractal Terrains" (SIGGRAPH 1989): wherever the ground
 * stands above a neighbour by more than the talus angle allows, part of the excess slides down
 * and lies there as scree. The talus angle is the angle of repose: at the scale of the working
 * cell, eroding mountain slopes cluster at that threshold, landslides trimming anything steeper
 * (Burbank et al., "Bedrock incision, rock uplift and threshold hillslopes in the northwestern
 * Himalayas", Nature 379, 1996). Then soil creep, linear diffusion (Culling 1960), smooths what
 * the water moved.
 */
import { EXCHANGE, type Field } from './hydraulic.ts';
import { REPOSE } from './rivers.ts';

const OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
/** Share of the excess moved per step: Musgrave et al.'s c = 0.5, stable for any neighbourhood. */
const SLIDE = 0.5;

/** One Jacobi step of the slide: each cell reads the ground as it was, `moved` holds the change. */
export function slide(f: Field, moved: Float32Array) {
  const { side, cell, b, rock, floor, sea } = f,
    excess = new Float64Array(OFFSETS.length),
    offsets = OFFSETS.map(([di, dj]) => dj * side + di),
    rise = OFFSETS.map(([di, dj]) => Math.hypot(di, dj) * cell * REPOSE);
  moved.fill(0);
  for (let j = 1; j < side - 1; j++)
    for (let i = 1; i < side - 1; i++) {
      const c = j * side + i;
      if (sea[c]) continue;
      let steepest = 0,
        total = 0;
      for (let k = 0; k < OFFSETS.length; k++) {
        const over = b[c] - b[c + offsets[k]] - rise[k];
        excess[k] = over > 0 ? over : 0;
        total += excess[k];
        if (over > steepest) steepest = over;
      }
      const amount = Math.min(SLIDE * steepest, b[c] - floor[c]);
      if (amount <= 0) continue;
      moved[c] -= amount;
      for (let k = 0; k < OFFSETS.length; k++)
        if (excess[k] > 0) moved[c + offsets[k]] += (amount * excess[k]) / total;
    }
  for (let c = 0; c < b.length; c++) {
    // Talus that falls into the sea is gone: the coastline stays where the relief put it.
    if (sea[c] || moved[c] === 0) continue;
    b[c] += moved[c];
    if (b[c] < rock[c]) rock[c] = b[c];
  }
}

/**
 * Weight of the creep's Laplacian per step: the grid's shortest ripple, two cells from crest to
 * crest, loses `4·κ` of its height per step, and the water can deepen it by at most `EXCHANGE`
 * of an imbalance; `κ = EXCHANGE / 4` keeps a ripple the grid cannot draw from ever growing.
 */
const CREEP = EXCHANGE / 4;

/**
 * One step of creep over what the erosion changed, `b − base`: the uneroded relief keeps its
 * detail, the water's work loses the ripples narrower than the grid carries. `scratch` is free.
 */
export function creep(f: Field, base: Float32Array, scratch: Float32Array) {
  const { side, b, rock, floor, sea } = f;
  for (let c = 0; c < b.length; c++) scratch[c] = b[c] - base[c];
  for (let j = 1; j < side - 1; j++)
    for (let i = 1; i < side - 1; i++) {
      const c = j * side + i;
      if (sea[c]) continue;
      const lap =
        scratch[c - 1] + scratch[c + 1] + scratch[c - side] + scratch[c + side] - 4 * scratch[c];
      b[c] = Math.max(floor[c], b[c] + CREEP * lap);
      if (b[c] < rock[c]) rock[c] = b[c];
    }
}
