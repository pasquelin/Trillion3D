import { retire } from '../../gpu/core/frameRetire.ts'
import { ggxMaxSpecWords } from '../../../../sdk-core/src/lighting/ggxMaxSpec.ts'
import {
  TOON_BUFFER_HEADER_WORDS,
  toonBufferWords,
  toonCapacityFor,
  toonLayout,
  toonResolutionOf,
  toonPatternsAt,
  type ToonLayout,
} from '../../../../sdk-core/src/lighting/toonProfile/rows.ts'
import { readShadingSetting } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { toonImagesOf, registeredToonProfiles } from './registry.ts'

/** The toon buffer of a device at a resolution, and the sizes it was made for, the runtimes (their run records) that use it now, and the image and collection's revision each runtime last followed it at (`followToonProfiles`; a runtime is keyed by its run record, so two runtimes of one device each follow once an image and none hides the other's). */
export interface Held {
  device: GPUDevice
  buffer: GPUBuffer
  texels: number
  rows: number
  slots: number
  /** Held strongly, no weak reference: a runtime's dispose is the engine's release path (`disposeWebgpuPages` always reaches `disposeLighting`, which calls `releaseToonTables`), so a run record never outlives its entry here. */
  users: Set<object>
  followed: WeakMap<object, { image: number; revision: number }>
}
/** Each device's buffers by the resolution they are baked at: two runtimes of one device at different resolutions each keep theirs, none replacing the other's. */
const held = new WeakMap<GPUDevice, Map<number, Held>>()
/** The buffer each runtime (run record) uses now: the texels it records. */
const using = new WeakMap<object, Held>()

let needsCache: { revision: number; rows: number; slots: number } | undefined

/** The rows (the default profile's and the profiles', none while no record is toon) and the pattern slots the profiles held need; counted once per revision of the collection. */
function toonNeeds() {
  const { profiles, users, revision } = registeredToonProfiles()
  if (needsCache?.revision === revision) return needsCache
  let slots = 0
  for (const profile of profiles) if (profile && toonImagesOf(profile)) slots++
  return (needsCache = { revision, rows: users === 0 ? 0 : profiles.length + 1, slots })
}

/**
 * THE TOON BUFFER of `device` (`toonProfile/rows.ts`), the tables the toon pixels are lit with, at the resolution `texels`, for the runtime `user`
 * (its run record), which records the texels it uses: sized from the profiles the materials hold — a header of four words while none is toon —,
 * its rows and pattern slots rounded up to a power of two. A buffer too small is replaced by a new one (the old one retired, the frame's commands
 * may name it) with its header and the peak table written; the rows and patterns are then written by `followToonProfiles`. Another resolution has
 * a buffer of its own; the one a runtime leaves for another resolution is retired when no other runtime records its texels.
 */
export function toonTablesOf(device: GPUDevice, texels: number, user: object): Held {
  const needs = toonNeeds()
  const rows = toonCapacityFor(needs.rows),
    slots = toonCapacityFor(needs.slots)
  let atDevice = held.get(device)
  if (!atDevice) held.set(device, (atDevice = new Map()))
  const kept = atDevice.get(texels)
  if (kept && kept.rows >= rows && kept.slots >= slots) return record(kept, user)
  // Grown, never shrunk: the capacities it had are kept.
  const layout = toonLayout(texels)
  const next: Held = {
    device,
    buffer: undefined as unknown as GPUBuffer,
    texels,
    rows: Math.max(rows, kept?.rows ?? 0),
    slots: Math.max(slots, kept?.slots ?? 0),
    users: new Set(kept?.users),
    followed: new WeakMap(),
  }
  next.buffer = device.createBuffer({
    label: 'Trillion3D toon tables v1',
    size: toonBufferWords(layout, next.rows, next.slots) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  if (next.rows > 0) writeHeader(device, next.buffer, layout, next.rows)
  if (kept) {
    retire(device, kept.buffer)
    for (const other of kept.users) using.set(other, next)
  }
  atDevice.set(texels, next)
  return record(next, user)
}

/** Records that `user` uses `tables` now: the buffer it used before at another resolution is released. */
function record(tables: Held, user: object) {
  const before = using.get(user)
  if (before !== tables) {
    // A buffer of another device than the one now asked can run nothing more: it goes at once.
    if (before) leave(before, user, before.device !== tables.device)
    tables.users.add(user)
    using.set(user, tables)
  }
  return tables
}

/** `user` no longer uses `tables`; the buffer none uses is retired, destroyed at once when its device was replaced (`replaced`) or is lost (the run record's `lost`): no command naming it will ever be submitted. */
function leave(tables: Held, user: object, replaced = false) {
  tables.users.delete(user)
  if (tables.users.size > 0) return
  retire(tables.device, tables.buffer, replaced || (user as { lost?: boolean }).lost === true)
  held.get(tables.device)?.delete(tables.texels)
}

/** The runtime `user` is disposed: it uses no toon buffer any more, and the one no other runtime uses is retired. */
export function releaseToonTables(user: object) {
  const tables = using.get(user)
  if (!tables) return
  using.delete(user)
  leave(tables, user)
}

/** The header (where the patterns start, the resolution, the words of a row) and the peak table of a buffer made for `rows` rows. */
function writeHeader(device: GPUDevice, buffer: GPUBuffer, layout: ToonLayout, rows: number) {
  device.queue.writeBuffer(
    buffer,
    0,
    new Uint32Array([toonPatternsAt(layout, rows), layout.texels, layout.rowWords, 0]),
  )
  device.queue.writeBuffer(buffer, TOON_BUFFER_HEADER_WORDS * 4, ggxMaxSpecWords())
}

/** The resolution the ramps and patterns are baked at: the setting `toonProfileResolution`, held to the least and to a multiple of 8. */
export const toonTexelsOf = (rt: Parameters<typeof readShadingSetting>[0]) =>
  toonResolutionOf(readShadingSetting(rt, 'toonProfileResolution'))

/** Whether the frame writes the toon data (`ContractKey.toonData`): the toon diffuse is applied once to the sum of the lights (`toonUnifiedDiffuse`) and a material is toon. */
export const toonDataOn = (rt: Parameters<typeof readShadingSetting>[0]) =>
  readShadingSetting(rt, 'toonUnifiedDiffuse') && toonNeeds().rows > 0
