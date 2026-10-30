import type { GroupCache } from '../bind/cachedGroup.ts'
import { isMadeEncoder, onSettled, retire } from './frameRetire.ts'

/** The buffers an encoder's runs took, held until it is submitted or dropped. */
interface Owner {
  readonly encoder: WeakRef<GPUCommandEncoder>
  readonly indices: number[]
}

/**
 * THE UNIFORMS OF THE RUNS OF AN ENCODE, one pool a view: a buffer for each run of an encoder (the
 * runs are encoded before any is submitted). An encoder keeps its buffers until it is submitted or
 * dropped (`onSettled`), so two encoders of a view open at once never overwrite each other; the
 * next encoder takes the lowest buffers no open encoder holds (an image encoded again after a drop
 * starts over). The pool is the view's own, so two views encoding at once never share a buffer.
 * Its owner is made for one device (a view's runs are keyed on the view and its device, `perViewRuns`; the other owners rebuild theirs where the device changes).
 * `release(device)` retires every buffer (this image's commands may still name them): once the encoders open at that moment have settled (`retire`), at once where that device was `replaced`.
 */
export function createUniformPool(label: string, bytes: number) {
  let owners: Owner[] = []
  // The ranks the open encoders hold, so that the next run finds a free rank without scanning every owner.
  const taken = new Set<number>()
  // Bumped by `release`: an encoder opened before it settles later without freeing the ranks a new owner holds.
  let generation = 0
  const drop = (gone: Owner) => {
    for (const index of gone.indices) taken.delete(index)
  }
  let buffers: GPUBuffer[] = []
  const release = (device: GPUDevice, replaced = false) => {
    // The encoders open now may bind these buffers: `retire` keeps them until those have settled (`frameRetire.ts`).
    for (const buffer of buffers) retire(device, buffer, replaced)
    buffers = []
    generation++
    owners = []
    taken.clear()
  }
  return {
    /** The buffer of the next run of `forEncoder`, and the run's rank in the pool. The encoder is one an image part made (`createImagePart`): a raw one would never settle and free its ranks. */
    next(on: GPUDevice, forEncoder: GPUCommandEncoder) {
      if (!isMadeEncoder(forEncoder)) throw new Error('GPU_UNIFORMS_RAW_ENCODER')
      let owner = owners.find(({ encoder }) => encoder.deref() === forEncoder)
      const fresh = !owner
      if (!owner) {
        // Weak: the pool, kept by the view, never holds an encoder (and its commands) alive; one collected unsettled is free.
        owners = owners.filter((open) => {
          const alive = !!open.encoder.deref()
          if (!alive) drop(open)
          return alive
        })
        owner = { encoder: new WeakRef(forEncoder), indices: [] }
        owners.push(owner)
      }
      let index = 0
      while (taken.has(index)) index++
      taken.add(index)
      owner.indices.push(index)
      if (fresh) {
        // Registered once the rank is held: an encoder already settled frees it at once, not before it was taken.
        const made = owner,
          opened = generation
        onSettled(forEncoder, () => {
          if (opened !== generation) return
          drop(made)
          owners = owners.filter((open) => open !== made)
        })
      }
      const buffer = (buffers[index] ??= on.createBuffer({
        label,
        size: bytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }))
      return { buffer, index }
    },
    release,
  }
}
type UniformPool = ReturnType<typeof createUniformPool>

/** The runs of one owner: the uniform pool of its runs and the cache of their bind groups (`groups`, of the shape the owner names them by). */
export interface Runs<G extends object = GroupCache> {
  uniforms: UniformPool
  groups: G
}

/** The runs of one owner: its uniform pool (`label`, `bytes` a run) and the bind group caches `groups`. */
export function createRuns<G extends object>(label: string, bytes: number, groups: G): Runs<G> {
  return { uniforms: createUniformPool(label, bytes), groups }
}

/** Bind group caches named by pass, none made yet. */
export const namedGroups = (): GroupCache => ({ groups: new Map() })

/**
 * THE RUNS OF A KERNEL, per view: the uniform pool of its runs and the cache of their bind groups
 * (kept while what they bind is the same), made at the view's first run. The state is the view's
 * (`key`) and its device (a replaced device retires the state it held at once), so the views of a device neither overwrite each other's uniforms nor evict each
 * other's groups.
 */
export const perViewRuns = (label: string, bytes: number) =>
  perViewRunsOf(label, bytes, namedGroups)

/** `perViewRuns` whose group caches are `makeGroups`' (a kernel that names its groups by field). */
export function perViewRunsOf<G extends object>(label: string, bytes: number, makeGroups: () => G) {
  const views = new WeakMap<object, Runs<G> & { device: GPUDevice }>()
  /** The view's uniforms retired and its groups forgotten. */
  const release = (key: object, replaced = false) => {
    const held = views.get(key)
    held?.uniforms.release(held.device, replaced)
    views.delete(key)
  }
  return {
    of(key: object, device: GPUDevice) {
      let held = views.get(key)
      if (held && held.device !== device) {
        release(key, true)
        held = undefined
      }
      if (!held) views.set(key, (held = { device, ...createRuns(label, bytes, makeGroups()) }))
      return held
    },
    release,
  }
}
