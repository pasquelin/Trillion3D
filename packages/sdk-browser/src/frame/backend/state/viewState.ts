import { viewKey } from './viewKey.ts'

const releasers: ((key: object) => void)[] = []

/**
 * The state a stage keeps for each view (`viewKey`): made by the stage at the first image of a view,
 * read and replaced through the view's gpu group, and released with the view — `dispose` runs on the
 * state when it is released or replaced (`release`), and the registry registers it once, so that the
 * release of a view's passes (`disposeViewStates`) lists no stage by name. States are released in the
 * order their stages were first loaded.
 */
export function viewState<T extends object>(dispose: (state: T) => void) {
  const held = new WeakMap<object, T>()
  const release = (key: object) => {
    const state = held.get(key)
    if (!state) return
    held.delete(key)
    dispose(state)
  }
  releasers.push(release)
  return {
    /** The view's state, none before the stage made it. */
    get: (gpu: { viewKey?: object }): T | undefined => held.get(viewKey(gpu)),
    /** Keeps `state` as the view's; the one it replaces is not released. */
    set(gpu: { viewKey?: object }, state: T) {
      held.set(viewKey(gpu), state)
    },
    /** The view's state let go (`dispose`) and forgotten. */
    release: (gpu: { viewKey?: object }) => release(viewKey(gpu)),
  }
}

/** Releases the state every stage kept for the view of `gpu` (`viewState`). */
export function disposeViewStates(gpu: { viewKey?: object }) {
  const key = viewKey(gpu)
  for (const release of releasers) release(key)
}
