/**
 * WHAT THE SAMPLED LIGHTING KEEPS OF A VIEW, in ONE record found by the view's key in one weak map: the device it was made on, the change of its lights' power and the ranks they had (`lightPower.ts`,
 * `previousRanks.ts`), the ratios of the image being encoded, the state of its two kits (the surfaces' and the nearest translucent layer's), and its volumes. Nothing holds a view's state but its record, so
 * a view key that is lost is collected with it; the device keeps only weak references, to free what the views left when it is disposed. The record is remade when the device is not the one it was made on.
 */
import type { createLightPower } from './lightPower.ts'
import type { createPreviousRanks } from './previousRanks.ts'
import type { createSampledLights, SampledKitState } from './sampledLights.ts'
import type { ViewVolumes } from './volumeFrame.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'

/** A layer's kit and the view's state in it, found together. */
export interface SampledLayer {
  readonly kit: ReturnType<typeof createSampledLights>
  readonly state: SampledKitState
}

export interface SampledView {
  readonly device: GPUDevice
  readonly key: object
  /** The ratios of this image's lights' power, none before they are measured. */
  ratios?: { image: number; buffer: GPUBuffer }
  power?: {
    power: ReturnType<typeof createLightPower>
    ranks: ReturnType<typeof createPreviousRanks>
  }
  surface?: SampledLayer
  front?: SampledLayer
  /** The last image the nearest translucent layer was lit, for the part to be freed once it idles. */
  frontUsed?: number
  /** The last image the sampled lighting ran for the view (or the first it was found off), for the power and volumes to be freed once it stays off. */
  litAt?: number
  volumes?: ViewVolumes
  /** What frees each part above, added as it is made. */
  readonly cleanups: Map<string, () => void>
  ref?: WeakRef<SampledView>
}

const records = new WeakMap<object, SampledView>()
const refsOfDevice = new WeakMap<GPUDevice, Set<WeakRef<SampledView>>>()

/** The record of the view, made at its first image, or again when its device changed (the old one is freed). */
export function viewRecord(gpu: { viewKey?: object }, device: GPUDevice): SampledView {
  const key = viewKey(gpu)
  const held = records.get(key)
  if (held?.device === device) return held
  if (held) releaseRecord(held)
  const record: SampledView = { device, key, cleanups: new Map() }
  const ref = (record.ref = new WeakRef(record))
  records.set(key, record)
  let refs = refsOfDevice.get(device)
  if (!refs) refsOfDevice.set(device, (refs = new Set()))
  for (const other of refs) if (!other.deref()) refs.delete(other)
  refs.add(ref)
  return record
}

/** The record of the view if it holds one on this device, none otherwise: a query makes and frees nothing. */
export function findRecord(gpu: { viewKey?: object }, device: GPUDevice): SampledView | undefined {
  const held = records.get(viewKey(gpu))
  return held?.device === device ? held : undefined
}

/** The part of the record in `field`, made at its first ask, its `free` running (the field being cleared) when the record is released. */
export function partOf<K extends 'power' | 'surface' | 'front' | 'volumes'>(
  record: SampledView,
  field: K,
  make: () => NonNullable<SampledView[K]>,
  free: (part: NonNullable<SampledView[K]>) => void,
): NonNullable<SampledView[K]> {
  const held = record[field]
  if (held) return held as NonNullable<SampledView[K]>
  const part = make()
  record[field] = part
  record.cleanups.set(field, () => {
    free(part)
    record[field] = undefined
  })
  return part
}

/** Frees one part of the record now (its field cleared), the next ask making it again: the part a view no longer reads (the sampled lighting off) is not kept. */
export function releasePart(record: SampledView, field: 'power' | 'surface' | 'front' | 'volumes') {
  record.cleanups.get(field)?.()
  record.cleanups.delete(field)
}

function releaseRecord(record: SampledView) {
  for (const free of record.cleanups.values()) free()
  record.cleanups.clear()
  records.delete(record.key)
  if (record.ref) refsOfDevice.get(record.device)?.delete(record.ref)
}

/** Frees everything the sampled lighting keeps for a view that leaves (its light power and previous ranks, its kits' state and groups, its volumes), found by the view's key alone. */
export function releaseSampledLightsView(gpu: { viewKey?: object }) {
  const held = records.get(viewKey(gpu))
  if (held) releaseRecord(held)
}

/** Frees what the views of a device left (a session's dispose). */
export function releaseSampledViewsOf(device: GPUDevice) {
  for (const ref of [...(refsOfDevice.get(device) ?? [])]) {
    const record = ref.deref()
    if (record) releaseRecord(record)
  }
  refsOfDevice.delete(device)
}
