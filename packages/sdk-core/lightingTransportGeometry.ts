import type { Scene } from './lightingExperimentScene.ts';
import type { TransportOptions } from './lightingTransportContracts.ts';
import type { TransportState } from './lightingTransportState.ts';
import { fail, progress } from './lightingTransportValidation.ts';
import { SURFACE_STRIDE, packSurface } from './lightingTransportIntersections.ts';
import { fillPatchRays } from './lightingTransportRays.ts';

export function updateTransportGeometry(
  state: TransportState,
  scene: Scene,
  options: TransportOptions,
) {
  const {
    size,
    surfaceCount,
    initialized,
    surfaceIds,
    columns,
    rows,
    moving,
    packed,
    cellOffsets,
    cellPatch,
    patchSurface,
    patchGeometry,
    patchChanged,
    raysPerPatch,
    rays,
    source,
    albedo,
  } = state;
  if (scene.patches.length !== size || scene.surfaces.length !== surfaceCount)
    fail('INCOMPATIBLE_SCENE', 'Patch topology changed; create a new transport state');
  progress(options, 'geometry', 0, surfaceCount);
  let geometryChanged = !initialized,
    staticChanged = !initialized,
    cell = 0;
  for (let i = 0; i < surfaceCount; i++) {
    const surface = scene.surfaces[i];
    if (
      surface.id !== surfaceIds[i] ||
      surface.columns !== columns[i] ||
      surface.rows !== rows[i] ||
      Number(surface.moving) !== moving[i]
    ) {
      fail('INCOMPATIBLE_SCENE', 'Surface identity, subdivision or moving classification changed');
    }
    const changed = packSurface(surface, packed, i * SURFACE_STRIDE);
    geometryChanged ||= changed;
    staticChanged ||= changed && !surface.moving;
    cellOffsets[i] = cell;
    cell += surface.columns * surface.rows;
  }
  const sphere = scene.sphere;
  const sphereChanged = sphere
    ? !state.sphereGeometry ||
      sphere.center.some((value, i) => value !== state.sphereGeometry![i]) ||
      sphere.radius !== state.sphereGeometry[3]
    : state.sphereGeometry !== null;
  geometryChanged ||= sphereChanged;
  staticChanged ||= sphereChanged;
  state.sphereGeometry = sphere
    ? [sphere.center[0], sphere.center[1], sphere.center[2], sphere.radius]
    : null;
  cellPatch.fill(-1);
  for (let i = 0; i < size; i++) {
    const patch = scene.patches[i];
    if (patch.surface !== patchSurface[i])
      fail('INCOMPATIBLE_SCENE', 'Patch surface identity changed');
    const vectors = [patch.center, patch.normal, patch.u, patch.v];
    let changed = !initialized;
    for (let vector = 0; vector < 4; vector++)
      for (let axis = 0; axis < 3; axis++) {
        const at = i * 12 + vector * 3 + axis,
          value = vectors[vector][axis];
        changed ||= patchGeometry[at] !== value;
        patchGeometry[at] = value;
      }
    patchChanged[i] = changed ? 1 : 0;
    geometryChanged ||= changed;
    if (changed) fillPatchRays(scene, i, raysPerPatch, rays);
    const at = patch.surface * SURFACE_STRIDE;
    const x = patch.center[0] - packed[at],
      y = patch.center[1] - packed[at + 1],
      z = patch.center[2] - packed[at + 2];
    const du = x * packed[at + 3] + y * packed[at + 4] + z * packed[at + 5];
    const dv = x * packed[at + 6] + y * packed[at + 7] + z * packed[at + 8];
    const u = packed[at + 12] * du + packed[at + 13] * dv,
      v = packed[at + 13] * du + packed[at + 14] * dv;
    const column = Math.floor(u * columns[patch.surface]),
      row = Math.floor(v * rows[patch.surface]);
    if (column < 0 || column >= columns[patch.surface] || row < 0 || row >= rows[patch.surface])
      fail('INVALID_SCENE', 'Patch centre is outside its surface');
    const slot = cellOffsets[patch.surface] + row * columns[patch.surface] + column;
    if (cellPatch[slot] !== -1) fail('INVALID_SCENE', 'Two patches occupy the same surface cell');
    cellPatch[slot] = i;
    for (let c = 0; c < 3; c++) {
      source[i * 3 + c] = patch.emission[c];
      albedo[i * 3 + c] = patch.albedo[c];
    }
  }
  if (cellPatch.some((value) => value < 0))
    fail('INVALID_SCENE', 'Surface subdivision has a missing patch');
  progress(options, 'geometry', surfaceCount, surfaceCount);

  return { geometryChanged, staticChanged };
}
