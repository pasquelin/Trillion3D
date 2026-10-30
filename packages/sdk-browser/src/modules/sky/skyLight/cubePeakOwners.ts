/** The owners of a measure, held weakly so a dropped runtime does not pin it: each with whether it wants the float cube kept for its own use. */
export interface Owners {
  readonly keep: WeakMap<object, boolean>
  refs: WeakRef<object>[]
}

export const newOwners = (): Owners => ({ keep: new WeakMap(), refs: [] })

/** The owners still alive and asking, the ones collected or given up dropped from the list. */
export function liveOwners(owners: Owners) {
  const live: object[] = []
  owners.refs = owners.refs.filter((ref) => {
    const owner = ref.deref()
    if (owner === undefined || !owners.keep.has(owner)) return false
    live.push(owner)
    return true
  })
  return live
}

/** `owner` registered, or its wish changed. */
export function setOwner(owners: Owners, owner: object, keep: boolean) {
  if (!owners.keep.has(owner)) owners.refs.push(new WeakRef(owner))
  owners.keep.set(owner, keep)
}

/** Whether any live owner wants the float cube kept. */
export const keepsFloats = (owners: Owners) =>
  liveOwners(owners).some((owner) => owners.keep.get(owner))
