import { pendingBuffers, type PendingGrowth } from '../../gpu/core/tableGrowth.ts'
import type { WebgpuLightState } from '../pages/state/lights.ts'

import { CLUSTER_SPHERE_FLOATS } from '../../gpu/shadow/sphereContract.ts'
import { ROW_LOD_FLOATS } from './rowLodWords.ts'
export { CLUSTER_SPHERE_FLOATS } from '../../gpu/shadow/sphereContract.ts'

/** Bytes a shadow row buffer of `words` 4-byte words per row takes at `casterSlots` rows: never
 *  empty, a binding holds at least a row. */
export const rowBufferBytes = (casterSlots: number, words: number) =>
  Math.max(1, casterSlots) * words * 4

/** GPU bytes the caster rows' shadow data takes at `casterSlots` rows — the world spheres, the
 *  mobility words, the detail — as their buffers are sized: what the first frame a light casts
 *  makes (`../pages/render/encodeDraws.ts`), and what the shadows reserve for it before
 *  (`vsmReserveBytes`). */
export const shadowRowBytes = (casterSlots: number) =>
  rowBufferBytes(casterSlots, CLUSTER_SPHERE_FLOATS) +
  rowBufferBytes(casterSlots, 1) +
  rowBufferBytes(casterSlots, ROW_LOD_FLOATS)

/** The world spheres of `casterSlots` rows, and their CPU copy (`bounds.ts`). */
export function clusterSpheres(device: GPUDevice, casterSlots: number) {
  const buffer = device.createBuffer({
    label: 'Trillion3D cluster spheres v1',
    size: rowBufferBytes(casterSlots, CLUSTER_SPHERE_FLOATS),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  return {
    buffer,
    packed: new Float32Array(casterSlots * CLUSTER_SPHERE_FLOATS),
    rows: casterSlots,
    /** The row runs `[from, to]` (flat pairs) the upload of `epoch` wrote (`uploadClusterSpheres`). */
    written: { epoch: 0, runs: [] as number[] },
    /** The runs the upload under way writes. */
    writing: undefined as number[] | undefined,
    /** Each row's local box, centre then half extent, as six doubles, and its CPU copy: made once
     *  a parent composes rows on the GPU, whose rows pass writes their spheres from it
     *  (`linkedRowSpheres`). */
    local: undefined as GPUBuffer | undefined,
    localPacked: undefined as Uint32Array<ArrayBuffer> | undefined,
  }
}

/** One mobility word per row of `casterSlots` rows (`mobility.ts`), the size its words take. */
export const mobilityRows = (device: GPUDevice, casterSlots: number) =>
  device.createBuffer({
    label: 'Trillion3D shadow row mobility v1',
    size: rowBufferBytes(casterSlots, 1),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

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
  const grown: PendingGrowth[] = []
  if (lights.spheres) {
    const next = clusterSpheres(device, casterSlots)
    grown.push(
      pendingBuffers([next.buffer], () => {
        const old = lights.spheres
        lights.spheres = next
        return [old?.buffer, old?.local]
      }),
    )
  }
  if (lights.mobilityRows) {
    const next = mobilityRows(device, casterSlots)
    grown.push(
      pendingBuffers([next], () => {
        const old = lights.mobilityRows
        lights.mobilityRows = next
        return [old]
      }),
    )
  }
  return grown
}
