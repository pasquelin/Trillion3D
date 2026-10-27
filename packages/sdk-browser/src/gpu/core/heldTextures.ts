import { ledgerAdmitted } from './deviceLedger.ts'
import { retire } from './frameRetire.ts'
import { countingAllocator, gpuAllocator, type ResourceAllocator } from './resourceAllocator.ts'

/** The textures a view names (`ResourceAllocator`), with the allocator that holds them and the bytes
 *  they take. */
export type AllocatedTextures<List extends object> = List & {
  readonly allocator: ReturnType<typeof gpuAllocator>
  readonly bytes: number
}

/** The textures `list` names, made on `device` under `label`, with their allocator and their bytes. A
 *  refusal midway leaves nothing behind. */
export function allocatedTextures<List extends object>(
  device: GPUDevice,
  label: string,
  list: (allocator: ResourceAllocator) => List,
): AllocatedTextures<List> {
  const allocator = gpuAllocator(device, label)
  try {
    return { ...list(allocator), allocator, bytes: allocator.bytes() }
  } catch (error) {
    allocator.destroy()
    throw error
  }
}

/** The bytes the textures `list` names would take, counted and not made: what a view asks the device's
 *  budget for (`ledgerAdmitted`), the same list as the one it makes them from. */
export function listedBytes(list: (allocator: ResourceAllocator) => unknown) {
  const counting = countingAllocator()
  list(counting)
  return counting.bytes()
}

/** What a set of resources is, beside its buffers and textures: the key it was made for (the values it depends on, compared one by
 *  one), its bytes and the means of giving it back. */
export interface HeldSet {
  readonly key: readonly unknown[]
  readonly bytes: number
  dispose(): void
}

/**
 * The resources `allocate` names, for `key`: `held` where it is for that key, else made, those held given back (retired,
 * the image being encoded may still name them) — where the device's budget leaves room (`ledgerAdmitted`); none where it
 * does not, with the reason. The bytes the budget is asked for are the allocations themselves, counted. `extend` adds to
 * what is made what is not an allocation (an upload, the writers over its buffers): it runs only on a making.
 * `fits`, given, keeps `held` too when it says the held set already holds what is asked (a set that only grows).
 */
export function ensureSet<S extends object, X extends object = Record<never, never>>(
  held: (S & X & HeldSet) | undefined,
  device: GPUDevice,
  {
    key,
    what,
    label,
    fits,
  }: {
    key: readonly unknown[]
    what: string
    label: string
    fits?: (held: S & X & HeldSet) => boolean
  },
  allocate: (allocator: ResourceAllocator) => S,
  extend?: (resources: S) => X,
): { resources?: S & X & HeldSet; why?: string } {
  if (
    held &&
    ((held.key.length === key.length && held.key.every((part, at) => part === key[at])) ||
      fits?.(held))
  )
    return { resources: held }
  const bytes = listedBytes(allocate)
  const { value, why } = ledgerAdmitted(device, {
    held,
    asked: bytes,
    what,
    make: () => {
      const allocator = gpuAllocator(device, label)
      const resources = allocate(allocator)
      return {
        ...resources,
        ...extend?.(resources),
        key,
        bytes,
        dispose: () => retire(device, { destroy: () => allocator.destroy() }),
      } as S & X & HeldSet
    },
  })
  return { resources: value, why }
}

/**
 * The textures a volume holds, made again, the old ones retired, when what it asks of them changes — the device's budget
 * to refuse them (`ledgerAdmitted`): the one place a volume's textures live and are given back. `release` retires them
 * (this image's commands may still name them); `generation` counts the makings, which the bind groups over them follow.
 */
export function createHeldTextures<List extends object>(device: GPUDevice) {
  let textures: AllocatedTextures<List> | undefined
  let generation = 0
  const release = () => {
    if (!textures) return
    retire(device, textures.allocator)
    textures = undefined
  }
  return {
    /** How many times the textures were made. */
    get generation() {
      return generation
    },
    /** Bytes the textures held take. */
    get bytes() {
      return textures?.bytes ?? 0
    },
    release,
    /** The held textures where `keeps` says they are what is asked; else new ones, as `request` makes them from the ones
     *  held — `asked` bytes, named `what` where the budget says no, `make` — and none where the device's budget refuses
     *  them. The volume is an optional allocation, an analytic one its fallback: made under the ledger's tentative
     *  admission, the memory it replaces counted out. */
    texturesOf(
      keeps: (held: AllocatedTextures<List>) => boolean,
      request: (held: AllocatedTextures<List> | undefined) => {
        asked: number
        what: string
        make: () => AllocatedTextures<List>
      },
    ) {
      if (textures && keeps(textures)) return textures
      const { asked, what, make } = request(textures)
      const held = textures && { bytes: textures.bytes, dispose: release }
      textures = ledgerAdmitted(device, { held, asked, what, make }).value
      if (textures) generation++
      return textures
    },
  }
}
