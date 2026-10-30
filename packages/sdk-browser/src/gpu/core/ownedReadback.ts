import { createReadbackRing, type ReadbackRing } from './readbackRing.ts'

/** What a ring of staging buffers is made of: its label, the bytes of a buffer and how many buffers fly at once. */
export interface OwnedReadbackOptions {
  readonly label: string
  readonly bytes: number
  readonly count: number
}

/**
 * THE STATE OF A READBACK A VIEW OWNS: one ring of staging buffers per owner (the runtime or the core a frame draws for), made at the first
 * ask with the state the caller keeps beside it, copied into a frame and read a few frames late, destroyed with the owner. `fresh` makes the
 * caller's state at the first ask (the ring is added to it as `ring`); `read` lands a mapped buffer in that state, given the tag the frame took
 * the buffer with. `submitted` maps what the frame's submit sent; `dispose` destroys the ring and gives the state back for the caller to release
 * what it holds besides.
 */
export function ownedReadbacks<S extends object, T = number>(
  options: OwnedReadbackOptions,
  fresh: (device: GPUDevice) => S,
  read: (own: S, mapped: ArrayBuffer, tag: T) => void,
) {
  type Own = S & { readonly ring: ReadbackRing<T> }
  const owned = new WeakMap<object, Own>()
  return {
    /** The owner's state, made with its ring at the first ask. */
    of(device: GPUDevice, owner: object): Own {
      let own = owned.get(owner)
      if (!own) {
        const made = fresh(device)
        const ring = createReadbackRing<T>(device, options, (mapped, _staging, tag) =>
          read(made, mapped, tag),
        )
        owned.set(owner, (own = Object.assign(made, { ring })))
      }
      return own
    },
    /** The owner's state, none before the first ask. */
    peek: (owner: object) => owned.get(owner),
    /** After the frame's submit: the copies taken map. */
    submitted: (owner: object) => owned.get(owner)?.ring.submitted(),
    /** The ring destroyed and the owner's state forgotten and handed back. */
    dispose(owner: object) {
      const own = owned.get(owner)
      own?.ring.destroy()
      owned.delete(owner)
      return own
    },
  }
}
