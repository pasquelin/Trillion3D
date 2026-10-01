import type { Surface, Vec3 } from '../scene/experimentScene.ts';
import type { TransportOptions } from './contracts.ts';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { updateTransportVisibility } from './visibility.ts';
import { solveTransportOracle } from './oracle.ts';
import {
  LIGHTING_TRANSPORT_ALGORITHM_VERSION,
  LIGHTING_TRANSPORT_FORMAT_VERSION,
} from './contracts.ts';
import { createLightingScenePatches } from '../scene/geometry.ts';

/** A closed unit box, every face turned inwards and cut in two by two; its ceiling emits. */
function box(albedo: Vec3, emission: Vec3 = [1, 2, 3]) {
  const faces: [Vec3, Vec3, Vec3][] = [
    [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ],
  ];
  const surfaces = faces.map(([origin, u, v], i): Surface => ({
    id: `face_${i}`,
    origin,
    u,
    v,
    albedo: [...albedo],
    emission: i === 3 ? [...emission] : [0, 0, 0],
    kind: 'diffuse',
    moving: false,
    columns: 2,
    rows: 2,
  }));
  return { surfaces, patches: createLightingScenePatches(surfaces) };
}
/** The transport state of `scene` with its operator traced, ready to solve. */
export function traced(albedo: Vec3, options: TransportOptions = {}, emission?: Vec3) {
  const scene = box(albedo, emission);
  const state = createTransportState(scene, { raysPerPatch: 16, ...options });
  updateTransportGeometry(state, scene, {});
  updateTransportVisibility(state, scene, 'rebuild', {}, true, true);
  return state;
}
export const oracle = (state: ReturnType<typeof traced>) =>
  solveTransportOracle({
    formatVersion: LIGHTING_TRANSPORT_FORMAT_VERSION,
    algorithmVersion: LIGHTING_TRANSPORT_ALGORITHM_VERSION,
    patchCount: state.size,
    matrix: state.matrix,
    source: state.source,
    albedo: state.albedo,
  }).radiance;
