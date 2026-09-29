import { pendingBuffers, type PendingGrowth } from '../../gpu/core/tableGrowth.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';

/** Floats of a cluster world sphere: centre then radius. */
export const CLUSTER_SPHERE_FLOATS = 4;

/** The world spheres of `casterSlots` rows, and their CPU copy (`bounds.ts`). */
export function clusterSpheres(device: GPUDevice, casterSlots: number) {
  const buffer = device.createBuffer({
    label: 'Trillion3D cluster spheres v1',
    size: Math.max(1, casterSlots) * CLUSTER_SPHERE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  return {
    buffer,
    packed: new Float32Array(casterSlots * CLUSTER_SPHERE_FLOATS),
    rows: casterSlots,
  };
}

/** One mobility word per row of `casterSlots` rows (`mobility.ts`), the size its words take. */
export const mobilityRows = (device: GPUDevice, casterSlots: number) =>
  device.createBuffer({
    label: 'Trillion3D shadow row mobility v1',
    size: Math.max(1, casterSlots) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

/**
 * The shadow pass's own buffers sized by row, for a table grown to `casterSlots` rows
 * (`../pages/prepare/growTables.ts`): the spheres and the mobility words, each where the session
 * already made it, put in place by `commit` at the size their next upload keeps. Every row is
 * dirty then, and the mobility words are written whole: both are filled again, once.
 */
export function growShadowRows(
  lights: WebgpuLightState,
  device: GPUDevice,
  casterSlots: number,
): PendingGrowth[] {
  const grown: PendingGrowth[] = [];
  if (lights.spheres) {
    const next = clusterSpheres(device, casterSlots);
    grown.push(
      pendingBuffers([next.buffer], () => {
        const old = lights.spheres?.buffer;
        lights.spheres = next;
        return [old];
      }),
    );
  }
  if (lights.mobilityRows) {
    const next = mobilityRows(device, casterSlots);
    grown.push(
      pendingBuffers([next], () => {
        const old = lights.mobilityRows;
        lights.mobilityRows = next;
        return [old];
      }),
    );
  }
  return grown;
}
