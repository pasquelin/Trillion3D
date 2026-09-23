import type { Scene } from '../scene/experimentScene.ts';
import type { TransportOptions } from './contracts.ts';
import type { TransportState } from './state.ts';
import { checkpoint, progress } from './validation.ts';
import { SURFACE_STRIDE, intersectSurface, intersectSphere } from './intersections.ts';

export function updateTransportVisibility(
  state: TransportState,
  scene: Scene,
  mode: 'rebuild' | 'reuse',
  options: TransportOptions,
  geometryChanged: boolean,
  staticChanged: boolean,
) {
  const {
    size,
    surfaceCount,
    raysPerPatch,
    initialized,
    patchChanged,
    counts,
    rays,
    moving,
    packed,
    hit,
    staticDistance,
    staticHit,
    staticUv,
    patchSurface,
    firstHit,
    matrix,
    rowSums,
    columns,
    rows,
    cellPatch,
    cellOffsets,
  } = state;
  function patchForHit(surface: number, u: number, v: number, front: boolean) {
    if (!front) return -1;
    const x = Math.min(columns[surface] - 1, Math.max(0, Math.floor(u * columns[surface])));
    const y = Math.min(rows[surface] - 1, Math.max(0, Math.floor(v * rows[surface])));
    return cellPatch[cellOffsets[surface] + y * columns[surface] + x];
  }

  let raysTraced = 0,
    movingRayTests = 0,
    staticSurfaceTests = 0,
    rowsUpdated = 0;
  if (mode === 'rebuild' || geometryChanged) {
    progress(options, 'visibility', 0, size);
    for (let i = 0; i < size; i++) {
      checkpoint(options);
      const rebuildStatic = mode === 'rebuild' || staticChanged || !!patchChanged[i];
      const rebuildRow = mode === 'rebuild' || !initialized;
      let rowChanged = rebuildRow;
      if (rebuildRow) counts.fill(0, i * size, (i + 1) * size);
      for (let sample = 0; sample < raysPerPatch; sample++) {
        if ((sample & 255) === 0) checkpoint(options);
        const ray = i * raysPerPatch + sample,
          rayOffset = ray * 6;
        if (rebuildStatic) {
          raysTraced++;
          let closest = Infinity,
            receiver = -1,
            receiverU = -1,
            receiverV = -1;
          for (let surface = 0; surface < surfaceCount; surface++)
            if (!moving[surface]) {
              staticSurfaceTests++;
              if (
                intersectSurface(packed, surface * SURFACE_STRIDE, rays, rayOffset, closest, hit)
              ) {
                closest = hit[0];
                receiverU = hit[1];
                receiverV = hit[2];
                receiver = patchForHit(surface, hit[1], hit[2], hit[3] !== 0);
              }
            }
          const sphereDistance = intersectSphere(scene, rays, rayOffset, closest);
          if (sphereDistance < closest) {
            closest = sphereDistance;
            receiver = -1;
            receiverU = -1;
            receiverV = -1;
          }
          staticDistance[ray] = closest;
          staticHit[ray] = receiver;
          staticUv[ray * 2] = receiverU;
          staticUv[ray * 2 + 1] = receiverV;
        }
        let closest = staticDistance[ray],
          receiver = staticHit[ray];
        if (receiver >= 0)
          receiver = patchForHit(
            patchSurface[receiver],
            staticUv[ray * 2],
            staticUv[ray * 2 + 1],
            true,
          );
        for (let surface = 0; surface < surfaceCount; surface++)
          if (moving[surface]) {
            movingRayTests++;
            if (intersectSurface(packed, surface * SURFACE_STRIDE, rays, rayOffset, closest, hit)) {
              closest = hit[0];
              receiver = patchForHit(surface, hit[1], hit[2], hit[3] !== 0);
            }
          }
        if (rebuildRow) {
          if (receiver >= 0) counts[i * size + receiver]++;
        } else if (receiver !== firstHit[ray]) {
          if (firstHit[ray] >= 0) counts[i * size + firstHit[ray]]--;
          if (receiver >= 0) counts[i * size + receiver]++;
          rowChanged = true;
        }
        firstHit[ray] = receiver;
      }
      if (rowChanged) {
        let hits = 0;
        for (let j = 0; j < size; j++) {
          const count = counts[i * size + j];
          matrix[i * size + j] = count / raysPerPatch;
          hits += count;
        }
        rowSums[i] = hits / raysPerPatch;
        rowsUpdated++;
      }
      if ((i & 15) === 15 || i === size - 1) progress(options, 'visibility', i + 1, size);
    }
  }
  return { raysTraced, movingRayTests, staticSurfaceTests, rowsUpdated };
}
