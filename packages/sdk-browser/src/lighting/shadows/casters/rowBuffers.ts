import { pendingBuffers, type PendingGrowth } from '../../../gpu/core/tableGrowth.ts'
import type { WebgpuLightState } from '../../../frame/backend/state/lights.ts'

import { CLUSTER_SPHERE_FLOATS } from '../sphereContract.ts'
import { createRowMotion } from '../rowMotion.ts'
import { ROW_LOD_FLOATS } from './rowLodWords.ts'
import { spheresMadeAnew } from './castChanges.ts'

/** Bytes a shadow row buffer of `words` 4-byte words per row takes at `casterSlots` rows: never
 *  empty, a binding holds at least a row. */
const rowBufferBytes = (casterSlots: number, words: number) => Math.max(1, casterSlots) * words * 4

/** GPU bytes the caster rows' shadow data takes at `casterSlots` rows — the world spheres, the
 *  mobility words, the detail — as their buffers are sized: what the first frame a light casts
 *  makes (`../../../frame/render/encodeDraws.ts`), and what the shadows reserve for it before
 *  (`vsmReserveBytes`). */
export const shadowRowBytes = (casterSlots: number) =>
  rowBufferBytes(casterSlots, CLUSTER_SPHERE_FLOATS) +
  rowBufferBytes(casterSlots, 1) +
  rowBufferBytes(casterSlots, ROW_LOD_FLOATS)

/** The world spheres of `casterSlots` rows, the rows pass's (`../../../placement/rows/rowWordsPass.ts`):
 *  the GPU's alone, never copied to the CPU. Beside them, what changed in them frame to frame
 *  (`motion`, `rowTravel.ts`), which the shadow raster sizes its chunks by, with the histograms the
 *  GPU makes of them (`../vsm/rows/rowPageBound.ts`). */
export function clusterSpheres(device: GPUDevice, casterSlots: number) {
  const buffer = device.createBuffer({
    label: 'Trillion3D cluster spheres v1',
    size: rowBufferBytes(casterSlots, CLUSTER_SPHERE_FLOATS),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  return { buffer, rows: casterSlots, motion: createRowMotion() }
}

/** One mobility word per row of `casterSlots` rows (`mobility.ts`), the size its words take. */
export const mobilityRows = (device: GPUDevice, casterSlots: number) =>
  device.createBuffer({
    label: 'Trillion3D shadow row mobility v1',
    size: rowBufferBytes(casterSlots, 1),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

/** One row's detail words per row of `casterSlots` rows (`rowLods.ts`). */
export const rowLodBuffer = (device: GPUDevice, casterSlots: number) => ({
  buffer: device.createBuffer({
    label: 'Trillion3D shadow row detail v1',
    size: rowBufferBytes(casterSlots, ROW_LOD_FLOATS),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  }),
  rows: casterSlots,
})

/**
 * THE ONE RESIZE OF THE SHADOW PASS'S BUFFERS SIZED BY ROW, for a table grown to `casterSlots` rows
 * (`../../../frame/prepare/growTables.ts`): the spheres, the mobility words and the row detail, each where
 * the session already made it, made aside under the growth's refusal scope and put in place by
 * `commit` at the size their next upload keeps, the old ones retired after the frame's submit. Their
 * first making (`ensureClusterSpheres`, `uploadDirtyRowMobility`, `ensureRowLods`) never resizes.
 * Every row is dirty then, and the mobility words are written whole: all are filled again, once —
 * the spheres and the detail by the rows pass, which derives every row of a buffer made anew.
 * Each is a step the growth makes in turn (`../../../frame/prepare/growGpuTables.ts`): a refusal of
 * one leaves those made before it to the growth, which frees them.
 */
export function growShadowRows(
  lights: WebgpuLightState,
  device: GPUDevice,
  casterSlots: number,
): (() => PendingGrowth)[] {
  /** The step growing the lights' `key` buffers: `make` them aside, `commit` putting them in
   *  place — `after` run then — and retiring the old ones; `bufferOf` is a made one's GPU buffer. */
  const step =
    <K extends 'spheres' | 'mobilityRows' | 'rowLods'>(
      key: K,
      make: () => NonNullable<WebgpuLightState[K]>,
      bufferOf: (held: NonNullable<WebgpuLightState[K]>) => GPUBuffer,
      after?: () => void,
    ) =>
    () => {
      const next = make()
      return pendingBuffers(device, [bufferOf(next)], () => {
        const old = lights[key]
        lights[key] = next
        after?.()
        return [old && bufferOf(old)]
      })
    }
  const steps: (() => PendingGrowth)[] = []
  if (lights.spheres)
    steps.push(
      step(
        'spheres',
        () => clusterSpheres(device, casterSlots),
        (held) => held.buffer,
        () => spheresMadeAnew(lights),
      ),
    )
  if (lights.mobilityRows)
    steps.push(
      step(
        'mobilityRows',
        () => mobilityRows(device, casterSlots),
        (held) => held,
      ),
    )
  if (lights.rowLods)
    steps.push(
      step(
        'rowLods',
        () => rowLodBuffer(device, casterSlots),
        (held) => held.buffer,
      ),
    )
  return steps
}
